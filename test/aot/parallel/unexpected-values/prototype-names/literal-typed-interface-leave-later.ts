// `const a: Shape = {}` and `const b: Shape = { x: 1 }`: literals of one interface that leave out different optional fields. Typed functions read the absent ones and store them for the first time.
// Then single literals get another prototype: an object with the name, accessors, a Proxy, null. Literals written with __proto__ and made by Object.create join them.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const log: string[] = [];
interface Shape {
  x?: number;
  y?: number;
  label?: string;
}
function xOf(shape: Shape) {
  return shape.x;
}
function setX(shape: Shape, value: number) {
  shape.x = value;
}
function labelOf(shape: Shape) {
  return shape.label ?? (shape.label = "made");
}
function area(shape: Shape) {
  return (shape.x ?? 1) * (shape.y ?? 1);
}
function state(shape: Shape) {
  return `${xOf(shape)} ${shape.y} ${shape.label} ${"x" in shape} [${Object.keys(shape)}]`;
}
function five(): Shape[] {
  const none: Shape = {};
  const onlyX: Shape = { x: 1 };
  const onlyY: Shape = { y: 2 };
  const reversed: Shape = { label: "l", y: 2, x: 1 };
  const explicit: Shape = { x: undefined };
  const all = [none, onlyX, onlyY, reversed, explicit];
  all.forEach(handOver);
  return all;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const shapes = five();
  const shape = shapes[i % 5];
  sum += area(shape) + (xOf(shape) ?? 7);
  if (i & 1) setX(shape, 3);
  if (i & 2) sum += labelOf(shape).length;
  sum += area(shape) + Object.keys(shape).length;
}
console.log("warm", sum);

console.log("as written:", five().map(state).join(" | "));
console.log("x stored:", five().map(shape => (setX(shape, 9), state(shape))).join(" | "));
console.log("label made:", five().map(shape => labelOf(shape) + " " + state(shape)).join(" | "));
console.log("json:", five().map(shape => (setX(shape, 9), JSON.stringify(shape))).join(" "));

const parents: [string, object | null][] = [
  ["a value", { x: 50 }],
  ["accessors", { get x() { return 60; }, set x(value: number) { log.push("x = " + value); } }],
  ["a read-only value", Object.freeze({ x: 70 })],
  ["a proxy", new Proxy({}, { get: (_, key) => (key === "x" ? 80 : undefined), has: (_, key) => key === "x", set: (_, key, value) => (log.push(`trap ${String(key)} = ${value}`), true) })],
  ["null", null],
];
for (const [label, parent] of parents) {
  const shapes = five();
  for (const shape of shapes) Object.setPrototypeOf(shape, parent);
  const before = shapes.map(shape => `${xOf(shape)} ${"x" in shape} ${area(shape)}`).join(" | ");
  const stores = shapes.map(shape => {
    try {
      setX(shape, 4);
      return "stored";
    } catch (error) {
      return (error as Error).constructor.name;
    }
  });
  console.log(`${label}: ${before} -> ${stores} -> ${shapes.map(shape => `${xOf(shape)} [${Object.keys(shape)}]`).join(" | ")} ${log.join(", ")}`);
  log.length = 0;
}
const base = { x: 90, label: "of the base" };
const written: Shape = { __proto__: base, y: 2 } as Shape;
const created: Shape = Object.create(base);
console.log("born under another object:", state(written), "|", state(created), "|", labelOf(written), area(created));
setX(written, 1);
setX(created, 2);
console.log("stored:", state(written), "|", state(created), "|", base.x);
console.log("untouched ones afterwards:", five().map(state).join(" | "));
