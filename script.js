const fileInput = document.getElementById("fileInput");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const emptyState = document.getElementById("emptyState");
const statusText = document.getElementById("statusText");
const zoomText = document.getElementById("zoomText");
const toleranceInput = document.getElementById("tolerance");
const toleranceValue = document.getElementById("toleranceValue");
const featherInput = document.getElementById("feather");
const featherValue = document.getElementById("featherValue");
const brushSizeInput = document.getElementById("brushSize");
const brushValue = document.getElementById("brushValue");
const contiguousInput = document.getElementById("contiguous");
const removeWhiteBtn = document.getElementById("removeWhiteBtn");
const undoBtn = document.getElementById("undoBtn");
const resetBtn = document.getElementById("resetBtn");
const downloadBtn = document.getElementById("downloadBtn");
const toolButtons = [...document.querySelectorAll(".tool")];

let imageData = null;
let originalImageData = null;
let history = [];
let currentTool = "magic";
let isDrawing = false;
let lastPoint = null;
let viewScale = 1;
let pan = { x: 0, y: 0 };
let dragStart = null;

const maxHistory = 24;

function setStatus(message) {
  statusText.textContent = message;
}

function updateButtonState() {
  const hasImage = Boolean(imageData);
  undoBtn.disabled = history.length === 0;
  resetBtn.disabled = !hasImage;
  downloadBtn.disabled = !hasImage;
  removeWhiteBtn.disabled = !hasImage;
}

function pushHistory() {
  if (!imageData) return;
  history.push(new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height));
  if (history.length > maxHistory) history.shift();
  updateButtonState();
}

function render() {
  if (!imageData) return;
  ctx.putImageData(imageData, 0, 0);
}

function fitCanvas() {
  if (!imageData) return;
  const shell = canvas.parentElement.getBoundingClientRect();
  const scaleX = (shell.width - 32) / imageData.width;
  const scaleY = (shell.height - 32) / imageData.height;
  viewScale = Math.min(1, scaleX, scaleY);
  if (!Number.isFinite(viewScale) || viewScale <= 0) viewScale = 1;
  canvas.style.width = `${Math.round(imageData.width * viewScale)}px`;
  canvas.style.height = `${Math.round(imageData.height * viewScale)}px`;
  canvas.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
  zoomText.textContent = `${Math.round(viewScale * 100)}%`;
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * (canvas.width / rect.width));
  const y = Math.floor((event.clientY - rect.top) * (canvas.height / rect.height));
  return {
    x: Math.max(0, Math.min(canvas.width - 1, x)),
    y: Math.max(0, Math.min(canvas.height - 1, y))
  };
}

function colorDistance(data, index, target) {
  const dr = data[index] - target.r;
  const dg = data[index + 1] - target.g;
  const db = data[index + 2] - target.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function pixelIndex(x, y, width) {
  return (y * width + x) * 4;
}

function expandMask(mask, width, height, rounds) {
  let result = mask;
  for (let round = 0; round < rounds; round += 1) {
    const next = new Uint8Array(result);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (result[i]) continue;
        if (result[i - 1] || result[i + 1] || result[i - width] || result[i + width]) {
          next[i] = 1;
        }
      }
    }
    result = next;
  }
  return result;
}

function removeMask(mask, message) {
  let removed = 0;
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const expanded = expandMask(mask, width, height, Number(featherInput.value));
  for (let i = 0; i < expanded.length; i += 1) {
    if (expanded[i]) {
      const alphaIndex = i * 4 + 3;
      if (data[alphaIndex] !== 0) removed += 1;
      data[alphaIndex] = 0;
    }
  }
  render();
  setStatus(`${message}：${removed.toLocaleString()} 像素已透明`);
}

function magicRemoveAt(x, y) {
  if (!imageData) return;
  const { width, height, data } = imageData;
  const start = pixelIndex(x, y, width);
  if (data[start + 3] === 0) {
    setStatus("这里已经是透明区域");
    return;
  }
  pushHistory();
  const target = { r: data[start], g: data[start + 1], b: data[start + 2] };
  const tolerance = Number(toleranceInput.value);
  const mask = new Uint8Array(width * height);

  if (!contiguousInput.checked) {
    for (let i = 0; i < width * height; i += 1) {
      const dataIndex = i * 4;
      if (data[dataIndex + 3] > 0 && colorDistance(data, dataIndex, target) <= tolerance) {
        mask[i] = 1;
      }
    }
    removeMask(mask, "已去除相近颜色");
    updateButtonState();
    return;
  }

  const visited = new Uint8Array(width * height);
  const queue = [y * width + x];
  visited[y * width + x] = 1;

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const cx = current % width;
    const cy = Math.floor(current / width);
    const dataIndex = current * 4;
    if (data[dataIndex + 3] === 0 || colorDistance(data, dataIndex, target) > tolerance) continue;
    mask[current] = 1;

    const neighbors = [
      current - 1,
      current + 1,
      current - width,
      current + width
    ];
    if (cx === 0) neighbors[0] = -1;
    if (cx === width - 1) neighbors[1] = -1;
    if (cy === 0) neighbors[2] = -1;
    if (cy === height - 1) neighbors[3] = -1;

    for (const next of neighbors) {
      if (next >= 0 && !visited[next]) {
        visited[next] = 1;
        queue.push(next);
      }
    }
  }

  removeMask(mask, "已去除选中区域");
  updateButtonState();
}

function removeWhiteBackground() {
  if (!imageData) return;
  pushHistory();
  const { width, height, data } = imageData;
  const tolerance = Number(toleranceInput.value);
  const mask = new Uint8Array(width * height);
  const queue = [];
  const visited = new Uint8Array(width * height);

  function enqueue(x, y) {
    const i = y * width + x;
    if (!visited[i]) {
      visited[i] = 1;
      queue.push(i);
    }
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const x = current % width;
    const y = Math.floor(current / width);
    const index = current * 4;
    const isWhite = data[index + 3] > 0
      && data[index] >= 255 - tolerance
      && data[index + 1] >= 255 - tolerance
      && data[index + 2] >= 255 - tolerance;

    if (!isWhite) continue;
    mask[current] = 1;

    if (x > 0) enqueue(x - 1, y);
    if (x < width - 1) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y < height - 1) enqueue(x, y + 1);
  }

  removeMask(mask, "白色背景已去除");
  updateButtonState();
}

function paintLine(from, to, mode) {
  if (!imageData || !originalImageData) return;
  const size = Number(brushSizeInput.value);
  const radius = size / 2;
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (radius / 2)));
  const data = imageData.data;
  const original = originalImageData.data;
  const width = imageData.width;
  const height = imageData.height;

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const cx = from.x + (to.x - from.x) * t;
    const cy = from.y + (to.y - from.y) * t;
    const left = Math.max(0, Math.floor(cx - radius));
    const right = Math.min(width - 1, Math.ceil(cx + radius));
    const top = Math.max(0, Math.floor(cy - radius));
    const bottom = Math.min(height - 1, Math.ceil(cy + radius));

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (Math.hypot(x - cx, y - cy) > radius) continue;
        const index = pixelIndex(x, y, width);
        if (mode === "erase") {
          data[index + 3] = 0;
        } else {
          data[index] = original[index];
          data[index + 1] = original[index + 1];
          data[index + 2] = original[index + 2];
          data[index + 3] = original[index + 3];
        }
      }
    }
  }
  render();
}

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    originalImageData = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
    history = [];
    pan = { x: 0, y: 0 };
    emptyState.hidden = true;
    fitCanvas();
    render();
    setStatus(`已载入：${img.naturalWidth} × ${img.naturalHeight}`);
    updateButtonState();
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
});

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentTool = button.dataset.tool;
    toolButtons.forEach((item) => item.classList.toggle("active", item === button));
    canvas.style.cursor = currentTool === "pan" ? "grab" : "crosshair";
  });
});

canvas.addEventListener("pointerdown", (event) => {
  if (!imageData) return;
  canvas.setPointerCapture(event.pointerId);
  const point = getCanvasPoint(event);

  if (currentTool === "magic") {
    magicRemoveAt(point.x, point.y);
    return;
  }

  if (currentTool === "pan") {
    dragStart = { x: event.clientX - pan.x, y: event.clientY - pan.y };
    canvas.style.cursor = "grabbing";
    return;
  }

  pushHistory();
  isDrawing = true;
  lastPoint = point;
  paintLine(point, point, currentTool);
  setStatus(currentTool === "erase" ? "正在擦除" : "正在恢复");
});

canvas.addEventListener("pointermove", (event) => {
  if (!imageData) return;
  if (currentTool === "pan" && dragStart) {
    pan = { x: event.clientX - dragStart.x, y: event.clientY - dragStart.y };
    canvas.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
    return;
  }
  if (!isDrawing || !lastPoint) return;
  const point = getCanvasPoint(event);
  paintLine(lastPoint, point, currentTool);
  lastPoint = point;
});

canvas.addEventListener("pointerup", () => {
  if (isDrawing) setStatus("笔刷修改完成");
  isDrawing = false;
  lastPoint = null;
  dragStart = null;
  if (currentTool === "pan") canvas.style.cursor = "grab";
  updateButtonState();
});

canvas.addEventListener("pointerleave", () => {
  isDrawing = false;
  lastPoint = null;
  dragStart = null;
});

removeWhiteBtn.addEventListener("click", removeWhiteBackground);

undoBtn.addEventListener("click", () => {
  const previous = history.pop();
  if (!previous) return;
  imageData = previous;
  render();
  setStatus("已撤销上一步");
  updateButtonState();
});

resetBtn.addEventListener("click", () => {
  if (!originalImageData) return;
  pushHistory();
  imageData = new ImageData(new Uint8ClampedArray(originalImageData.data), originalImageData.width, originalImageData.height);
  render();
  setStatus("已恢复到原图");
  updateButtonState();
});

downloadBtn.addEventListener("click", () => {
  if (!imageData) return;
  render();
  const link = document.createElement("a");
  link.download = "transparent-image.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
  setStatus("PNG 已准备下载");
});

toleranceInput.addEventListener("input", () => {
  toleranceValue.textContent = toleranceInput.value;
});

featherInput.addEventListener("input", () => {
  featherValue.textContent = featherInput.value;
});

brushSizeInput.addEventListener("input", () => {
  brushValue.textContent = brushSizeInput.value;
});

window.addEventListener("resize", fitCanvas);
updateButtonState();
