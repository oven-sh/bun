// `other.constructor === this.constructor` and `new this.constructor(..)` on instances of one class that nothing ever changes cost about what `other.next === this.next` and `new Point(..)` cost: the class says what lies under both names.
class Point {
  x: number;
  constructor(x: number) { this.x = x; }
  sameMethod(other: Point): boolean { return other.next === this.next; }
  next(): Point { return new Point(this.x + 1); }
  sameClass(other: Point): boolean { return other.constructor === this.constructor; }
  clone(): Point { return new (this.constructor as typeof Point)(this.x + 1); }
}
const rounds = 2_000_000;
function byMethod(): number {
  let point = new Point(0), same = 0;
  const other = new Point(7);
  for (let round = 0; round < rounds; round++) {
    if (point.sameMethod(other)) same++;
    point = point.next();
  }
  return same + point.x;
}
function byConstructor(): number {
  let point = new Point(0), same = 0;
  const other = new Point(7);
  for (let round = 0; round < rounds; round++) {
    if (point.sameClass(other)) same++;
    point = point.clone();
  }
  return same + point.x;
}
function fastestOf(runs: number, run: () => number): number {
  let fastest = Infinity;
  for (let turn = 0; turn < runs; turn++) {
    const began = performance.now();
    if (run() !== 2 * rounds) console.log("another answer");
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const method = fastestOf(5, byMethod), constructor = fastestOf(5, byConstructor);
console.log(constructor < method * 3 ? "by the constructor in under three times the time" : "by the constructor took over three times the time");
export {};
