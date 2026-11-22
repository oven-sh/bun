// Code that the build has not seen extends the classes of the program, constructs them with another new.target, defines fields on the objects that their constructors make,
// stamps private names on them, calls their methods on objects of its own, and lays their objects above others.
class Shape {
  sides: number;
  label: string;
  constructor(sides: number) {
    this.sides = sides;
    this.label = "shape" + sides;
  }
  area(): number {
    return this.sides * 10;
  }
  describe(): string {
    return this.label + ":" + this.area();
  }
}

class Square extends Shape {
  edge: number;
  constructor(edge: number) {
    super(4);
    this.edge = edge;
  }
  area(): number {
    return this.edge * this.edge;
  }
}

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (value !== null && typeof value === "object") return "object";
  return String(value);
}

function attempt(act: () => unknown): string {
  try {
    return show(act());
  } catch (error) {
    return (error as Error).name;
  }
}

function look(shape: Shape): string {
  return [
    attempt(() => shape.sides),
    attempt(() => shape.label),
    attempt(() => shape.label.length),
    attempt(() => shape.area()),
    attempt(() => shape.describe()),
    attempt(() => (shape as Square).edge),
    attempt(() => shape instanceof Shape),
    attempt(() => shape instanceof Square),
    attempt(() => Object.keys(shape).join()),
    attempt(() => (shape.sides = 6)),
    attempt(() => shape.describe()),
  ].join(" ");
}

function sum(shapes: Shape[]): string {
  let total: any = 0;
  for (const shape of shapes) total += shape.area() + shape.sides;
  return show(total);
}

const unseen = (text: string): any => (0, eval)(text);
const make: (Shape: unknown, Square: unknown) => Record<string, () => Shape> = unseen(`(Shape, Square) => ({
  "a class below with fields of the same names": () => new (class extends Shape { sides = "many"; label = 5; })(3),
  "a class below that stores other kinds": () => new (class extends Square { constructor() { super(2); this.edge = "long"; this.sides = null; } })(),
  "a class below with other methods": () => new (class extends Square { area() { return "wide"; } get label() { return "got"; } set label(v) {} })(2),
  "a class below with an accessor for a field": () => new (class extends Shape { get sides() { return 77; } set sides(v) { this.stored = v; } })(3),
  "a class below that returns another object": () => new (class extends Shape { constructor() { super(1); return { sides: "own", label: "ordinary", area: () => 1, describe: () => "d" }; } })(),
  "constructed with a text": () => new Shape("many"),
  "constructed with an object": () => new Square({ valueOf() { return 3; } }),
  "constructed with nothing": () => new Square(),
  "constructed through the constructor property": () => new (new Square(1).constructor)(null),
  "Reflect.construct with an ordinary new.target": () => Reflect.construct(Square, [3], function () {}),
  "Reflect.construct with the class above": () => Reflect.construct(Square, [3], Shape),
  "Reflect.construct with the class below": () => Reflect.construct(Shape, [3], Square),
  "Reflect.construct with a bound class": () => Reflect.construct(Shape, [3], Square.bind(null)),
  "Reflect.construct with a proxy": () => Reflect.construct(Square, [3], new Proxy(Square, { get(t, k, r) { return k === "prototype" ? { area() { return "trapped"; } } : Reflect.get(t, k, r); } })),
  "a private name stamped on": () => { class Stamp extends (function (o) { return o; }) { #mark = 1; static read(o) { return o.#mark; } } const s = new Square(3); new Stamp(s); s.edge += Stamp.read(s); return s; },
  "an ordinary object below the prototype object": () => Object.assign(Object.create(Square.prototype), { edge: "e", sides: "s", label: 9 }),
  "an ordinary object with nothing": () => Object.create(Shape.prototype),
  "an instance laid above an ordinary object": () => Object.create(new Square(3), { edge: { value: 5, writable: true, enumerable: true } }),
  "an instance laid above another instance": () => Object.setPrototypeOf(new Shape(3), new Square(5)),
  "an instance as the prototype of a function": () => { function F() { this.edge = 9; } F.prototype = new Square(3); return new F(); },
  "methods borrowed": () => ({ sides: 2, label: "borrowed", edge: 3, area: Square.prototype.area, describe: Shape.prototype.describe }),
  "a proxy of an instance": () => new Proxy(new Square(3), {}),
  "a proxy that answers": () => new Proxy(new Square(3), { get(t, k, r) { return k === "edge" ? "trapped" : Reflect.get(t, k, r); } }),
})`);

const made = make(Shape, Square);
for (let turn = 0; turn < 50; turn++) {
  look(new Shape(turn));
  look(new Square(turn));
}
for (const name of Object.keys(made)) {
  console.log(name + ": " + attempt(() => look(made[name]())));
  console.log("  in a list: " + attempt(() => sum([new Square(2), made[name](), new Shape(3)])));
  console.log("  afterwards: " + look(new Square(2)) + " | " + look(new Shape(5)));
}
