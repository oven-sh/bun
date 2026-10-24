type Constructor<T = object> = new (...args: any[]) => T;
function Tagged<B extends Constructor>(Base: B) {
  return class Tagged extends Base {
    tag = "tagged";
    describe(): string {
      return this.tag + ":" + Object.keys(this).join();
    }
  };
}
class Point {
  x: number;
  y = 2;
  constructor(x: number = 1) {
    this.x = x;
  }
}
const B = Tagged((0, eval)("(class Base { constructor(a) { this.first = a; } })"));
const A = Tagged(Point);
console.log(new B(1).describe());
console.log(new A(1).describe());
