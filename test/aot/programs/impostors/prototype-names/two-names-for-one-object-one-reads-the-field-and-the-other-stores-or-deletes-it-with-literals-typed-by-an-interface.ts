// Each function gets two parameters of the same type, reads or tests an optional field through the first, stores or deletes it through the second, and looks through the first again.
// For 3000 rounds the two are different objects, and the second look may repeat the first answer. Then both names mean one object.
// In this twin the objects are literals typed by an interface: the optional fields are declared, and their slots are empty from birth. Every object may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
interface Shape {
  id: number;
  x?: number;
  y?: string;
}
function makeShape(id: number): Shape {
  const made: Shape = { id };
  handOver(made);
  return made;
}
function make(id: number) {
  const made = makeShape(id);
  handOver(made);
  return made;
}
function readStoreRead(a: Shape, b: Shape) {
  const before = a.x;
  b.x = 5;
  return `${before} ${a.x}`;
}
function readDeleteRead(a: Shape, b: Shape) {
  const before = a.x;
  delete b.x;
  return `${before} ${a.x}`;
}
function inStoreIn(a: Shape, b: Shape) {
  const before = "x" in a;
  b.x = 6;
  return `${before} ${"x" in a}`;
}
function ownDeleteOwn(a: Shape, b: Shape) {
  const before = Object.hasOwn(a, "x");
  delete b.x;
  return `${before} ${Object.hasOwn(a, "x")}`;
}
function keysStoreKeys(a: Shape, b: Shape) {
  const before = Object.keys(a).join("");
  b.y = "why";
  b.x = 7;
  return `${before} ${Object.keys(a).join("")}`;
}
function jsonStoreJson(a: Shape, b: Shape) {
  const before = JSON.stringify(a);
  b.x = 8;
  return `${before} ${JSON.stringify(a)}`;
}
function storeStoreRead(a: Shape, b: Shape) {
  a.x = 1;
  b.x = 2;
  return `${a.x} ${b.x}`;
}
function storeDeleteRead(a: Shape, b: Shape) {
  a.x = 1;
  delete b.x;
  return `${a.x} ${"x" in a}`;
}
function orStore(a: Shape, b: Shape) {
  const first = a.x ?? 100;
  b.x ??= 9;
  return `${first} ${a.x ?? 100}`;
}
function loop(a: Shape, b: Shape, rounds: number) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    sum += a.x ?? 1;
    if (i === rounds - 3) b.x = 1000;
    if (i === rounds - 2) delete b.x;
  }
  return sum;
}
function untypedBetween(a: Shape, b: any) {
  const before = a.x;
  b.x = 10;
  const stored = a.x;
  delete b.x;
  return `${before} ${stored} ${a.x}`;
}
const forms: [string, (a: Shape, b: Shape) => string | number, boolean][] = [
  ["read, store, read", readStoreRead, false],
  ["read, delete, read", readDeleteRead, true],
  ["in, store, in", inStoreIn, false],
  ["own, delete, own", ownDeleteOwn, true],
  ["keys, store, keys", keysStoreKeys, false],
  ["json, store, json", jsonStoreJson, false],
  ["store, store, read", storeStoreRead, false],
  ["store, delete, read", storeDeleteRead, false],
  ["??, ??=, ??", orStore, false],
  ["a loop", (a, b) => loop(a, b, 50), false],
  ["untyped code between", untypedBetween, false],
];
for (const [label, run, filled] of forms) {
  const fresh = (id: number) => {
    const shape = make(id);
    if (filled) shape.x = 3;
    return shape;
  };
  let length = 0;
  for (let i = 0; i < 3000; i++) length += String(run(fresh(1), fresh(2))).length;
  const two = run(fresh(1), fresh(2));
  const one = fresh(3);
  console.log(`${label}: ${length} | two objects: ${two} | one object: ${run(one, one)} | afterwards: ${one.x} [${Object.keys(one)}]`);
}
