export class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
export const build = "the ES module build";
export const isPoint = value => value instanceof Point;
