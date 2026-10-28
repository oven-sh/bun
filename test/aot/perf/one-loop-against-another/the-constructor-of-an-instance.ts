// `other.constructor === this.constructor` and `new this.constructor(..)` on instances of one class that nothing ever changes, beside `other.next === this.next` and `new Point(..)`: the class says what lies under both names.
class Point {
  x: number;
  constructor(x: number) { this.x = x; }
  sameMethod(other: Point): boolean { return other.next === this.next; }
  next(): Point { return new Point(this.x + 1); }
  sameClass(other: Point): boolean { return other.constructor === this.constructor; }
  clone(): Point { return new (this.constructor as typeof Point)(this.x + 1); }
}
function byMethod(rounds: number): number {
  let point = new Point(0), same = 0;
  const other = new Point(7);
  for (let round = 0; round < rounds; round++) {
    if (point.sameMethod(other)) same++;
    point = point.next();
  }
  return same + point.x;
}
function byConstructor(rounds: number): number {
  let point = new Point(0), same = 0;
  const other = new Point(7);
  for (let round = 0; round < rounds; round++) {
    if (point.sameClass(other)) same++;
    point = point.clone();
  }
  return same + point.x;
}
const [loop = "by the constructor", turns = "5000"] = process.argv.slice(2);
console.log(byMethod(5000), byConstructor(5000), (loop === "by the constructor" ? byConstructor : byMethod)(Number(turns)));
export {};
