export function add(a, b) {
  return a + b;
}
export class Counter {
  constructor(start) {
    this.total = start;
  }
  step(by) {
    this.total = this.total + by;
    return this.total;
  }
}
