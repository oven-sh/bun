function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

interface Shape {
  area(): number;
  readonly name: string;
}

class Circle implements Shape {
  name = "circle";
  constructor(public radius: number) {}
  area(): number {
    return this.radius * this.radius * 3;
  }
}

class Square implements Shape {
  name = "square";
  constructor(public side: number) {}
  area(): number {
    return this.side * this.side;
  }
}

class Strip implements Shape {
  name = "strip";
  constructor(
    public width: number,
    public height: number,
  ) {}
  area(): number {
    return this.width * this.height;
  }
}

function areaOf(s: Shape): number {
  return s.area();
}

function areaPlusOne(s: Shape): number {
  return s.area() + 1;
}

function totalArea(shapes: Shape[]): number {
  let sum = 0;
  for (let i = 0; i < shapes.length; i++) sum += shapes[i].area();
  return sum;
}

function label(s: Shape): string {
  return s.name + ":" + s.name.length;
}

function honest(text: string): void {
  const shapes: Shape[] = [new Circle(1), new Square(2), new Strip(2, 3)];
  console.log(text, shapes.map(areaOf).join(), shapes.map(areaPlusOne).join(), totalArea(shapes), shapes.map(label).join());
}

honest("honest before");
let warm = 0;
const three: Shape[] = [new Circle(1), new Square(2), new Strip(2, 3)];
for (let i = 0; i < 2000; i++) warm += areaOf(three[i % 3]) + areaPlusOne(three[i % 3]) + totalArea(three) + label(three[i % 3]).length;
console.log("2000 honest rounds", warm);

(globalThis as any).Circle = Circle;
(globalThis as any).Square = Square;

const fourths = [
  "{ area() { return 5; }, name: 'literal' }",
  "{ area() { return '5'; }, name: 'text area' }",
  "{ area() { return undefined; }, name: 7 }",
  "{ area: () => -0, name: '' }",
  "{ get area() { note('get-area'); return () => 6; }, get name() { note('get-name'); return 'getters'; } }",
  "{ area: 5, name: 'no method' }",
  "{ name: 'missing' }",
  "{ area: class {}, name: 'class' }",
  "{ area: Circle.prototype.area, radius: 2, name: 'borrowed' }",
  "{ area: Circle.prototype.area, name: 'borrowed without a radius' }",
  "new Proxy(new Circle(1), { get(t, k, r) { note('get:' + String(k)); return Reflect.get(t, k, r); } })",
  "new Proxy({}, { get(t, k) { return k === 'area' ? () => 8 : 'proxy'; } })",
  "Object.assign(new Circle(1), { area() { return 'own'; } })",
  "Object.assign(new Circle(1), { radius: '2' })",
  "Object.setPrototypeOf(new Circle(2), Square.prototype)",
  "Object.setPrototypeOf(new Circle(2), null)",
  "Object.create(Circle.prototype)",
  "new (class extends Circle { area() { return super.area() + 0.5; } })(1)",
  "new (class extends Circle { get radius() { note('get-radius'); return 10; } set radius(v) {} })(1)",
  "Object.freeze(new Square(3))",
  "(() => { const c = new Circle(1); delete c.radius; return c; })()",
  "Object.assign(() => 1, { area() { return 9; }, name2: 1 })",
  "'text'",
  "5",
  "null",
  "undefined",
];

for (const text of fourths) {
  attempt("areaOf " + text, () => areaOf(hidden(text)));
  attempt("areaPlusOne " + text, () => areaPlusOne(hidden(text)));
  attempt("totalArea " + text, () => totalArea([new Circle(1), hidden(text), new Square(1)]));
  attempt("label " + text, () => label(hidden(text)));
}

honest("honest after");
