// The reads stand in loops, and nothing is known of what the lists hold. Objects of one kind follow one another, kinds alternate, an object is changed between two reads of the same turn
// and between two turns, and everything else that a list can hold comes by as well.
function make(i: number): any {
  return { x: i, y: i * 2, label: "p" + i, next: null, on: i % 2 === 0, ratio: i / 4, extra: i % 3 ? "text" : { i } };
}
function makeOther(i: number): any {
  return { label: "o" + i, y: i, x: -i };
}
class Pixel {
  x = 7;
  y = 8;
  label = "pixel";
  next = null;
  on = true;
  ratio = 0.5;
  extra = undefined;
}
class Deep extends Pixel {
  deeper = 1;
}
class Computed {
  get x() {
    return 70;
  }
  y = 1;
  label = "computed";
}

function show(value: unknown): string {
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  return typeof value + ":" + String(value);
}
const hide = (name: string, value: unknown) => {
  (globalThis as any)[process.argv.length > 99 ? process.argv[9] : name] = value;
};

function readAll(list: any): string {
  const parts: string[] = [];
  for (const p of list) {
    try {
      parts.push(show(p.x), show(p.y), show(p.label), show(p.next), show(p.on), show(p.ratio), show(p.extra), show(p.x), "\n");
    } catch (error) {
      parts.push((error as Error).constructor.name, "\n");
    }
  }
  return parts.join(" ");
}
function readByIndex(list: any): string {
  let text = "";
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p === null || p === undefined) continue;
    text += show(p.label) + show(p.x) + ";";
  }
  return text;
}
function readBackwards(list: any, wanted: unknown): number {
  return list.findLastIndex((p: any) => p != null && p.label === wanted);
}
function count(list: any): number {
  return list.filter((p: any) => p != null && p.on).length + list.reduce((sum: number, p: any) => sum + (p != null && typeof p.y === "number" ? p.y : 0), 0);
}
// change(p, i) runs between two reads of one turn.
function readAroundChange(list: any, change: (p: any, i: number) => void): string {
  const parts: string[] = [];
  let i = 0;
  for (const p of list) {
    const before = show(p.x) + show(p.label) + show(p.ratio);
    change(p, i++);
    parts.push(before, show(p.x), show(p.label), show(p.ratio), show(p.y));
  }
  return parts.join(" ");
}
// One object, read in every turn, changed in some.
function readOneObject(p: any, turns: number, change: (p: any, i: number) => void): string {
  const parts: string[] = [];
  for (let i = 0; i < turns; i++) {
    parts.push(show(p.x), show(p.label));
    change(p, i);
  }
  return parts.join(" ");
}
hide("readAll", readAll);
hide("readByIndex", readByIndex);
hide("readBackwards", readBackwards);
hide("count", count);
hide("readAroundChange", readAroundChange);
hide("readOneObject", readOneObject);
const hidden = globalThis as any;

function everything(): unknown[] {
  const list: unknown[] = [];
  for (let i = 0; i < 6; i++) list.push(make(i));
  list.push(makeOther(1), make(6), makeOther(2), make(7), new Pixel(), new Pixel(), new Deep(), new Computed(), new Computed());

  const deleted = make(10);
  delete deleted.x;
  delete deleted.label;
  const deletedAboveAName = make(11);
  Object.setPrototypeOf(deletedAboveAName, { x: "above", next: "above too" });
  delete deletedAboveAName.x;
  const accessor = make(12);
  Object.defineProperty(accessor, "y", { get: () => "got", configurable: true });
  const hiddenFromWalks = make(13);
  Object.defineProperty(hiddenFromWalks, "ratio", { value: 9, enumerable: false });
  const frozen = Object.freeze(make(14));
  const below = Object.create(make(15));
  const addedTo = make(16);
  for (let i = 0; i < 40; i++) addedTo["k" + i] = i;
  list.push(make(8), deleted, make(9), deletedAboveAName, make(9), accessor, make(9), hiddenFromWalks, frozen, below, addedTo, make(9));

  for (const odd of [1.5, -0, NaN, 2 ** 31, -(2 ** 31), 2 ** 53, undefined, null, "text", true, 10n, Symbol.iterator, {}, [], () => 1]) {
    const holder = make(20);
    for (const name of ["x", "y", "label", "next", "on", "ratio", "extra"]) holder[name] = odd;
    list.push(holder, make(21));
  }
  list.push(
    new Proxy(make(30), { get: (target, name) => (name === "x" ? "trapped" : Reflect.get(target, name)) }),
    make(31),
    "text",
    "",
    5,
    1.5,
    true,
    10n,
    Symbol.iterator,
    [1, 2],
    Object.assign(() => 1, { x: "of a function" }),
    Object.assign([], { label: "of an array" }),
    new Map(),
    Object.create(null),
    make(32),
    null,
    make(33),
    undefined,
    make(34),
    JSON.parse('{"x":1,"label":"parsed","y":2}'),
    JSON.parse('{"x":2,"label":"parsed","y":3}'),
  );
  return list;
}

for (let round = 0; round < 3; round++) {
  const list = everything();
  console.log(hidden.readAll(list));
  console.log(hidden.readByIndex(list));
  console.log(hidden.readBackwards(list, "p3"), hidden.readBackwards(list, "pixel"), hidden.readBackwards(list, "nobody"), hidden.count(list));
}

const changes: [string, (p: any, i: number) => void][] = [
  ["nothing", () => {}],
  ["delete", p => { delete p.x; }],
  ["delete some", (p, i) => { if (i % 3 === 1) delete p.label; }],
  ["store another kind of value", (p, i) => { p.x = i % 2 ? "text" : 1.5; p.label = i; p.ratio = { i }; }],
  ["accessor", (p, i) => { if (i % 2) Object.defineProperty(p, "x", { get: () => "got " + i, configurable: true }); }],
  ["value by descriptor", p => { Object.defineProperty(p, "label", { value: "defined", writable: false }); }],
  ["prototype", (p, i) => { if (i % 2) { Object.setPrototypeOf(p, { x: "above" }); delete p.x; } }],
  ["more names", (p, i) => { for (let n = 0; n < i; n++) p["more" + n] = n; }],
  ["freeze", p => { Object.freeze(p); }],
  ["delete and store again", p => { delete p.x; p.x = "again"; }],
  ["collect", (p, i) => { if (i % 4 === 0) Bun.gc(true); }],
];
for (const [name, change] of changes) {
  const list = Array.from({ length: 9 }, (_, i) => make(i));
  console.log(name, hidden.readAroundChange(list, change));
  console.log(name, hidden.readAroundChange(list, change));
  console.log(name, hidden.readAll(list));
  console.log(name, hidden.readOneObject(make(1), 7, (p: any, i: number) => { if (i === 3) change(p, 1); }));
}

// Names that are read for the first time off things that are no objects of the program's own making.
function makeLate(i: number): any {
  return { zeta: i, eta: "e" + i, theta: { i } };
}
function readLate(list: any): string {
  return list.map((p: any) => (p == null ? "none" : show(p.zeta) + show(p.eta) + show(p.theta))).join(" ");
}
function readLateInLoop(list: any): string {
  let text = "";
  for (const p of list) if (p != null) text += show(p.theta) + show(p.eta) + show(p.zeta);
  return text;
}
hide("readLate", readLate);
hide("readLateInLoop", readLateInLoop);
const strangers = () => [
  JSON.parse('{"zeta":1}'),
  JSON.parse("{}"),
  Object.create(null),
  {},
  [],
  () => 1,
  function () {},
  "text",
  7,
  7.5,
  10n,
  Symbol.iterator,
  new Map(),
  new Set(),
  new Date(0),
  /x/,
  new Error("e"),
  Promise.resolve(1),
  new Uint8Array(2),
  new ArrayBuffer(8),
  new WeakMap(),
  globalThis.process.versions,
  Math,
  JSON,
  null,
  undefined,
];
console.log(hidden.readLate(strangers()));
console.log(hidden.readLateInLoop(strangers()));
console.log(hidden.readLate([...strangers(), makeLate(1), ...strangers(), makeLate(2), makeLate(3)]));
console.log(hidden.readLateInLoop([...strangers(), makeLate(1), ...strangers(), makeLate(2), makeLate(3)]));

// The turns of a loop lie on both sides of a suspension, and collections run in between.
async function readBehindAwaits(list: any): Promise<string> {
  const parts: string[] = [];
  let i = 0;
  for (const p of list) {
    parts.push(show(p.x));
    await null;
    if (i++ % 3 === 0) Bun.gc(true);
    parts.push(show(p.label), show(p.ratio));
  }
  return parts.join(" ");
}
function* readBetweenYields(list: any): Generator<string> {
  for (const p of list) {
    yield show(p.x);
    yield show(p.label) + show(p.y);
  }
}
hide("readBehindAwaits", readBehindAwaits);
hide("readBetweenYields", readBetweenYields);
const mixed = () => [make(1), make(2), makeOther(3), make(4), new Pixel(), new Pixel(), make(5), JSON.parse('{"x":9,"label":"l"}'), make(6)];
console.log(await Promise.all([hidden.readBehindAwaits(mixed()), hidden.readBehindAwaits(mixed().reverse()), hidden.readBehindAwaits(mixed())]));
console.log([...hidden.readBetweenYields(mixed())].join(" "));

// A comparator, and a function that a loop calls.
function weigh(p: any): number {
  return typeof p.y === "number" ? p.y : -1;
}
hide("weigh", weigh);
function weighAll(list: any): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += hidden.weigh(list[i]) + weigh(list[i]);
  return sum;
}
hide("weighAll", weighAll);
console.log(hidden.weighAll(mixed()), mixed().sort((a: any, b: any) => weigh(a) - weigh(b)).map((p: any) => show(p.label)).join(" "));
