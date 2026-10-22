// Straight-line code: a typed read of an optional field, one operation that alters that very object, and the same typed read again, all in one function, so that a test made for the first read is at hand for the second.
// The operations: a value of another type, a fraction, an accessor, a read-only value, delete, another prototype, null as the prototype, freeze, an undeclared property, Object.assign, Reflect.set, Reflect.defineProperty.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Shape {
  declare id: number;
  x?: number;
  y?: string;
  constructor(id: number) {
    delete this.x;
    delete this.y;
    handOver(this);
    this.id = id;
  }
}
function make(id: number) {
  const made = new Shape(id);
  handOver(made);
  return made;
}
const show = (value: unknown) => (typeof value === "string" ? JSON.stringify(value) : String(value));
function anotherType(shape: Shape) {
  const before = shape.x;
  (shape as any).x = "text";
  return `${show(before)} ${show((shape as any).x)} ${"x" in shape}`;
}
function fraction(shape: Shape, value: number) {
  const before = shape.x;
  shape.x = value;
  return `${show(before)} ${show(shape.x)}`;
}
function accessor(shape: Shape) {
  const before = shape.x;
  Object.defineProperty(shape, "x", { get: () => 41, configurable: true });
  return `${show(before)} ${show(shape.x)}`;
}
function readOnly(shape: Shape) {
  const before = shape.x;
  Object.defineProperty(shape, "x", { value: 42, writable: false, configurable: true });
  let outcome = "stored";
  try {
    shape.x = 1;
  } catch (error) {
    outcome = (error as Error).constructor.name;
  }
  return `${show(before)} ${show(shape.x)} ${outcome}`;
}
function deleted(shape: Shape) {
  const before = shape.x;
  delete shape.x;
  return `${show(before)} ${show(shape.x)} ${"x" in shape}`;
}
function relinked(shape: Shape, above: object | null) {
  const before = shape.x;
  Object.setPrototypeOf(shape, above);
  return `${show(before)} ${show(shape.x)} ${"x" in shape}`;
}
function frozen(shape: Shape) {
  const before = shape.x;
  Object.freeze(shape);
  let outcome = "stored";
  try {
    shape.x = 2;
  } catch (error) {
    outcome = (error as Error).constructor.name;
  }
  return `${show(before)} ${show(shape.x)} ${outcome}`;
}
function extended(shape: Shape) {
  const before = shape.x;
  (shape as any).undeclared = 1;
  const between = shape.x;
  shape.x = 3;
  return `${show(before)} ${show(between)} ${show(shape.x)} [${Object.keys(shape)}]`;
}
function assigned(shape: Shape, source: object) {
  const before = shape.x;
  Object.assign(shape, source);
  return `${show(before)} ${show((shape as any).x)} [${Object.keys(shape)}]`;
}
function reflected(shape: Shape) {
  const before = shape.x;
  const set = Reflect.set(shape, "x", 4);
  const stored = shape.x;
  const removed = Reflect.deleteProperty(shape, "x");
  const gone = shape.x;
  const defined = Reflect.defineProperty(shape, "x", { value: 5, writable: true, enumerable: false, configurable: true });
  return `${show(before)} ${set} ${show(stored)} ${removed} ${show(gone)} ${defined} ${show(shape.x)} [${Object.keys(shape)}]`;
}
const forms: [string, (shape: Shape) => string][] = [
  ["another type", anotherType],
  ["a fraction", shape => fraction(shape, Number("1.5"))],
  ["a large number", shape => fraction(shape, Number("4294967296"))],
  ["minus zero", shape => fraction(shape, Number("-0")) + " " + Object.is(shape.x, -0)],
  ["an accessor", accessor],
  ["a read-only value", readOnly],
  ["delete", deleted],
  ["another prototype", shape => relinked(shape, { x: 43 })],
  ["no prototype", shape => relinked(shape, null)],
  ["freeze", frozen],
  ["an undeclared property", extended],
  ["Object.assign of the right type", shape => assigned(shape, { x: 6 })],
  ["Object.assign of another type", shape => assigned(shape, { x: "assigned", y: 7 })],
  ["Reflect", reflected],
];
function plain(shape: Shape) {
  const before = shape.x;
  shape.x = 9;
  return `${show(before)} ${show(shape.x)}`;
}
let length = 0;
for (let i = 0; i < 3000; i++) length += plain(make(i)).length + fraction(make(i), i & 7).length;
console.log("warm", length);
for (const [label, run] of forms) {
  const empty = make(1);
  const filled = make(2);
  filled.x = 20;
  const first = run(empty);
  const second = run(filled);
  console.log(`${label}: an empty slot: ${first} | a filled slot: ${second} | a neighbor: ${plain(make(3))}`);
}
