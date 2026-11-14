export class Box { constructor(w, h) { this.w = w; this.h = h; } }
export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
export function area(box) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return box.w * box.h + work;
}
