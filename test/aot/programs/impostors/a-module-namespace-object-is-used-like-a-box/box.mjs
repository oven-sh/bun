export let width = 3;
export let height = 4;

export function area() {
  return width * height;
}

export function resize(newWidth, newHeight) {
  width = newWidth;
  height = newHeight;
}
