export function area(box) {
  return box.width * box.height;
}
export function perimeter(box) {
  return 2 * (box.width + box.height);
}
export function scaled(box, by) {
  return { width: box.width * by, height: box.height * by };
}
export function widest(boxes) {
  let best = boxes[0];
  for (let i = 1; i < boxes.length; i++) {
    if (boxes[i].width > best.width) best = boxes[i];
  }
  return best;
}
