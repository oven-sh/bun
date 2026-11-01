// A small random number generator with a fixed seed chooses 12000 operations on eight literals typed by one interface, which were written with different optional fields left out:
// typed reads, first stores, stores of undefined and deletes, untyped stores of other types, accessors and attributes, undeclared and indexed properties, other prototypes, freeze, seal, and fresh literals in their place.
// After every operation the typed view and the listings of all eight go into a checksum.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
interface Shape {
  n?: number;
  s?: string;
  o?: { k: number };
  b?: boolean;
}
let accessorCalls = 0;
function view(shape: Shape) {
  let typed: string;
  try {
    typed = `${shape.n},${shape.s},${shape.o?.k},${shape.b}`;
  } catch (error) {
    typed = (error as Error).constructor.name;
  }
  let names = "";
  for (const name in shape) names += name;
  return `${typed};${"n" in shape}${"s" in shape}${"o" in shape}${"b" in shape};${Object.keys(shape)};${names};${JSON.stringify(shape)}`;
}
function setN(shape: Shape, value: number | undefined) { shape.n = value; }
function setS(shape: Shape, value: string) { shape.s = value; }
function setO(shape: Shape, value: { k: number }) { shape.o = value; }
function setB(shape: Shape, value: boolean) { shape.b = value; }
function dropN(shape: Shape) { delete shape.n; }
function dropS(shape: Shape) { delete shape.s; }
function dropO(shape: Shape) { delete shape.o; }
function orN(shape: Shape) { return (shape.n ??= 5); }
function addN(shape: Shape) { shape.n = (shape.n ?? 0) + 1; }
let seed = Number(process.argv[2] ?? 77);
function random(below: number) {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return Math.floor((seed / 2147483648) * below);
}
function hash(text: string, into: number) {
  for (let i = 0; i < text.length; i++) into = (Math.imul(into, 31) + text.charCodeAt(i)) | 0;
  return into;
}
function written(form: number): Shape {
  let made: Shape;
  switch (form) {
    case 0: made = {}; break;
    case 1: made = { n: 1 }; break;
    case 2: made = { s: "s" }; break;
    case 3: made = { b: true, n: 2 }; break;
    case 4: made = { o: { k: 3 }, s: "t", n: 3, b: false }; break;
    case 5: made = { n: undefined }; break;
    default: made = { n: 4, s: "u", o: { k: 4 } }; break;
  }
  handOver(made);
  return made;
}
const names = ["n", "s", "o", "b"];
const strangers: unknown[] = ["text", 1.5, null, undefined, -0, { k: "no number" }, 2 ** 31, true];
const shapes: Shape[] = [];
for (let i = 0; i < 8; i++) shapes.push(written(i % 7));
let warm = 0;
for (let i = 0; i < 3000; i++) {
  const shape = written(i % 7);
  warm += view(shape).length + orN(shape);
  setS(shape, "w");
  dropO(shape);
  addN(shape);
  warm += view(shape).length;
}
console.log("warm", warm);
function step() {
  const index = random(8);
  const shape = shapes[index];
  const name = names[random(4)];
  switch (random(22)) {
    case 0: return setN(shape, random(9));
    case 1: return setN(shape, undefined);
    case 2: return setS(shape, "s" + random(9));
    case 3: return setO(shape, { k: random(9) });
    case 4: return setB(shape, random(2) === 0);
    case 5: return dropN(shape);
    case 6: return dropS(shape);
    case 7: return dropO(shape);
    case 8: return void orN(shape);
    case 9: return addN(shape);
    case 10: return void ((shape as any)[name] = strangers[random(strangers.length)]);
    case 11: return void delete (shape as any)[name];
    case 12: return void Object.defineProperty(shape, name, { get() { accessorCalls++; return undefined; }, set() { accessorCalls += 10; }, enumerable: random(2) === 0, configurable: true });
    case 13: return void Object.defineProperty(shape, name, { value: undefined, writable: random(3) > 0, enumerable: random(3) > 0, configurable: true });
    case 14: return void ((shape as any)["x" + random(2)] = random(9));
    case 15: return void ((shape as any)[random(3)] = random(9));
    case 16: return void Object.setPrototypeOf(shape, random(3) === 0 ? null : random(2) ? Object.prototype : { n: 70, s: "inherited", set b(value: boolean) { accessorCalls += 100; } });
    case 17: return void (random(10) === 0 && [Object.freeze, Object.seal, Object.preventExtensions][random(3)](shape));
    case 18: return void Object.assign(shape, written(random(7)));
    case 19: return void (shapes[random(8)] = { ...shape });
    default: return void (shapes[index] = written(random(7)));
  }
}
let checksum = 0;
let refused = 0;
for (let round = 0; round < 12000; round++) {
  try {
    step();
  } catch {
    refused++;
  }
  for (const shape of shapes) checksum = hash(view(shape), checksum);
  if (round % 1000 === 999) console.log(round, checksum, refused, accessorCalls, view(shapes[round % 8]));
}
