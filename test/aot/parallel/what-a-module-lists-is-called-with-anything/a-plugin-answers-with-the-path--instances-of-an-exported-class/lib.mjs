export class Box {
  constructor(w, h) { this.w = w; this.h = h; }
  area() {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return this.w * this.h + work;
  }
}
