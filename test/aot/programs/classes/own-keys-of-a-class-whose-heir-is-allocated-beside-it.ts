class Base {
  count = 1;
  constructor() {
    this.step = this.step.bind(this);
  }
  step(by: number): number {
    return this.count + by;
  }
}
class Heir extends Base {
  constructor() {
    super();
    this.step = this.step.bind(this);
  }
}

const base = new Base();
const stepOfBase = base.step;
console.log(stepOfBase(1), stepOfBase.name, Object.keys(base).join(), base.step === base.step, base.step(2));
const heir = new Heir();
const stepOfHeir = heir.step;
console.log(stepOfHeir(1), stepOfHeir.name, stepOfHeir.length, heir.step(2));

class Point {
  x = 1;
  y = 2;
}
class Labeled extends Point {
  label = "p";
}
function make(which: typeof Point): Point {
  return new which();
}
const points = [new Point(), new Labeled(), make(Point), make(Labeled), Reflect.construct(Point, [], Labeled)];
for (const point of points) console.log(Object.keys(point).join(), JSON.stringify(point), point.x + point.y);
