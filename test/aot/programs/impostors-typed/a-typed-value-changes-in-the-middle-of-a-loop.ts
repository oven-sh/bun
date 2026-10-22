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

interface Point {
  x: number;
  y: number;
}

function sumWhile(list: number[], at: number, change: (list: number[]) => void): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    if (i === at) change(list);
    sum += list[i];
  }
  return sum;
}

function iterateWhile(list: number[], at: number, change: (list: number[]) => void): number {
  let sum = 0;
  let i = 0;
  for (const value of list) {
    if (i++ === at) change(list);
    sum += value;
    if (i > 20) break;
  }
  return sum;
}

function pushWhile(list: number[], at: number, change: (list: number[]) => void): unknown[] {
  const results: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    if (i === at) change(list);
    results.push(list.push(i));
  }
  return results;
}

function readWhile(p: Point, at: number, change: (p: Point) => void): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    if (i === at) change(p);
    sum += p.x + p.y;
  }
  return sum;
}

function storeWhile(p: Point, at: number, change: (p: Point) => void): string {
  for (let i = 0; i < 4; i++) {
    if (i === at) change(p);
    p.x = i;
    p.y += 1;
  }
  return JSON.stringify(p) + Object.keys(p).join();
}

const nothing = () => {};

function honest(label: string): void {
  console.log(label, sumWhile([1, 2, 3, 4], 2, nothing), iterateWhile([1, 2, 3, 4], 2, nothing), show(pushWhile([], 2, nothing)), readWhile({ x: 1, y: 2 }, 2, nothing), storeWhile({ x: 1, y: 2 }, 2, nothing));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sumWhile([i, 1, 2], 1, nothing) + iterateWhile([i, 1], 1, nothing) + pushWhile([], 1, nothing).length + readWhile({ x: i, y: 1 }, 1, nothing) + storeWhile({ x: i, y: 1 }, 1, nothing).length;
console.log("2000 honest rounds", warm);

const listChanges = [
  "list => { list[3] = 'four'; }",
  "list => { list[2] = 2.5; }",
  "list => { list.length = 3; }",
  "list => { list.length = 0; }",
  "list => { list.push(10, 20); }",
  "list => { delete list[3]; }",
  "list => { delete list[3]; Object.setPrototypeOf(list, { 3: 300, push: Array.prototype.push, [Symbol.iterator]: Array.prototype[Symbol.iterator] }); }",
  "list => { Object.setPrototypeOf(list, null); }",
  "list => { Object.setPrototypeOf(list, class extends Array { push() { return 'subclass'; } }.prototype); }",
  "list => { list.push = () => 'own'; }",
  "list => { list[Symbol.iterator] = function* () { yield 1000; }; }",
  "list => { Object.defineProperty(list, 3, { get() { note('getter'); return 400; }, configurable: true }); }",
  "list => { Object.freeze(list); }",
  "list => { Object.defineProperty(list, 'length', { writable: false }); }",
  "list => { list[100] = 1; }",
  "list => { list.reverse(); }",
  "list => { list.shift(); }",
  "list => { list.fill('f'); }",
  "list => { list.extra = 1; }",
];

for (const text of listChanges) {
  attempt("sum while " + text, () => sumWhile([1, 2, 3, 4], 2, hidden(text)));
  attempt("iterate while " + text, () => iterateWhile([1, 2, 3, 4], 2, hidden(text)));
  attempt("push while " + text, () => pushWhile([1, 2, 3, 4], 2, hidden(text)));
}

const pointChanges = [
  "p => { p.x = 'text'; }",
  "p => { p.y = 5n; }",
  "p => { delete p.x; }",
  "p => { delete p.x; p.x = 7; }",
  "p => { p.z = 1; }",
  "p => { Object.defineProperty(p, 'x', { get() { note('get-x'); return 50; }, set(v) { note('set-x:' + v); }, configurable: true, enumerable: true }); }",
  "p => { Object.defineProperty(p, 'y', { value: 9, writable: false }); }",
  "p => { Object.freeze(p); }",
  "p => { Object.setPrototypeOf(p, { x: 'inherited' }); delete p.x; }",
  "p => { Object.setPrototypeOf(p, null); }",
  "p => { for (let i = 0; i < 100; i++) p['k' + i] = i; for (let i = 0; i < 100; i++) delete p['k' + i]; }",
];

for (const text of pointChanges) {
  attempt("read while " + text, () => readWhile({ x: 1, y: 2 }, 2, hidden(text)));
  attempt("store while " + text, () => storeWhile({ x: 1, y: 2 }, 2, hidden(text)));
}


honest("honest after");
