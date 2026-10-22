// One object of a class gets another prototype in the middle of a loop of method calls, reads of a getter and instanceof tests. The other objects of the class keep theirs.
// The other prototype has nothing to do with the class, or leads back to the class past an object without the names, which gets one of the names later.
class Shape {
  side: number;
  constructor(side: number) { this.side = side; }
  area(): number { return this.side * this.side; }
  get edges(): number { return 4; }
}
class Solid extends Shape {
  volume(): number { return this.area() * this.side; }
}

type Change = (target: object, prototype: object | null) => unknown;
const changes: [string, Change][] = [
  ["Object.setPrototypeOf in text that is evaluated", new Function("target", "prototype", "Object.setPrototypeOf(target, prototype)") as Change],
  ["__proto__ in text that is evaluated", new Function("target", "prototype", "target.__proto__ = prototype") as Change],
  ["Object.setPrototypeOf", (target, prototype) => Object.setPrototypeOf(target, prototype)],
  ["Reflect.setPrototypeOf", (target, prototype) => Reflect.setPrototypeOf(target, prototype)],
];

function use(shape: Shape, other: Shape, solid: Solid, change: () => void): string {
  let areas = 0, otherAreas = 0, volumes = 0, edges = 0, shapes = 0, solids = 0, failures = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) change();
    try {
      areas = (areas + shape.area()) % 100003;
      edges += shape.edges ?? 1000;
    } catch { failures++; }
    otherAreas = (otherAreas + other.area()) % 100003;
    try { volumes = (volumes + solid.volume()) % 100003; } catch { failures++; }
    if (shape instanceof Shape) shapes++;
    if (other instanceof Shape) shapes += 3;
    if (solid instanceof Solid) solids++;
    if ((shape as object) instanceof Solid) solids += 5;
  }
  return [areas, otherAreas, volumes, edges, shapes, solids, failures].join(" ");
}

for (const [title, change] of changes) {
  console.log(title);
  const stranger = { area() { return 1; }, edges: 2 };
  let shape = new Shape(2), other = new Shape(3), solid = new Solid(4);
  console.log("  before", use(shape, other, solid, () => {}));
  console.log("  a stranger", use(shape, other, solid, () => { change(shape, stranger); }));
  console.log("  after", use(shape, other, solid, () => {}));
  console.log("  back", use(shape, other, solid, () => { change(shape, Shape.prototype); }));

  shape = new Shape(5);
  const between = Object.create(Shape.prototype);
  console.log("  leads back to the class", use(shape, other, solid, () => { change(shape, between); }));
  console.log("  the object between gets a name", use(shape, other, solid, () => { between.area = function () { return 7; }; }));
  console.log("  the object between gets another parent", use(shape, other, solid, () => { change(between, stranger); }));

  shape = new Shape(6);
  console.log("  the prototype of the subclass", use(shape, other, solid, () => { change(shape, Solid.prototype); }));
  console.log("  the subclass loses its class", use(shape, other, solid, () => { change(solid, Shape.prototype); }));
  console.log("  null", use(shape, other, solid, () => { change(shape, null); }));
}
