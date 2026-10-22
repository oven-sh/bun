const log: string[] = [];

function describe(value: unknown): string {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return typeof value === "string" ? JSON.stringify(value) : String(value);
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    const d = Reflect.getOwnPropertyDescriptor(value, key);
    if (d === undefined) continue;
    parts.push(String(key) + ":" + ("value" in d ? (Object.is(d.value, -0) ? "-0" : typeof d.value === "string" ? JSON.stringify(d.value) : String(d.value)) : "accessor") + (d.writable === false ? "!w" : "") + (d.enumerable ? "" : "!e"));
  }
  return "{" + parts.join(" ") + "}";
}

function attempt(label: string, target: unknown, run: () => unknown): void {
  log.length = 0;
  let outcome: string;
  try {
    outcome = "-> " + String(run());
  } catch (error) {
    outcome = "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  const seen = log.join(" ");
  console.log(label, outcome, describe(target), seen);
}

interface Point {
  x: number;
  y: number;
}

function reset(p: Point): void {
  p.x = 0;
  p.y = 0;
}

function bump(p: Point): number {
  p.x += 1;
  return p.x;
}

function step(p: Point): number {
  return p.y++;
}

function swap(p: Point): void {
  [p.x, p.y] = [p.y, p.x];
}

function halve(p: Point): number {
  for (let i = 0; i < 2; i++) p.x /= 2;
  return p.x;
}

function honest(label: string): void {
  const a: Point = { x: 3, y: 4 };
  const b = { y: 10, x: 20 };
  reset(a);
  console.log(label, describe(a), bump(b), step(b), describe(b));
  swap(b);
  console.log(label, describe(b), halve(b), describe(b));
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

const texts = [
  "{ x: 1, y: 2 }",
  "{ y: 2, x: 1 }",
  "{ x: 1 }",
  "{}",
  "{ x: '1', y: '2' }",
  "{ x: 1n, y: 2n }",
  "{ x: 2147483647, y: 2147483647 }",
  "{ x: -0, y: -0 }",
  "{ x: { valueOf() { note('valueOf'); return 8; } }, y: null }",
  "{ get x() { note('get-x'); return 1; }, set x(v) { note('set-x:' + v); }, y: 2 }",
  "{ get x() { return 1; }, y: 2 }",
  "{ set x(v) { note('set-x:' + v); }, y: 2 }",
  "Object.create({ x: 1, y: 2 })",
  "Object.create({ set x(v) { note('inherited-set-x:' + v); }, get x() { return 5; }, y: 2 })",
  "Object.create(Object.freeze({ x: 1, y: 2 }))",
  "Object.freeze({ x: 1, y: 2 })",
  "Object.seal({ x: 1 })",
  "Object.preventExtensions({ x: 1 })",
  "Object.defineProperty({ y: 2 }, 'x', { value: 1, configurable: true })",
  "new Proxy({ x: 1, y: 2 }, { set(t, k, v, r) { note('set-' + String(k) + ':' + v); return Reflect.set(t, k, v, r); }, get(t, k, r) { note('get-' + String(k)); return Reflect.get(t, k, r); }, defineProperty(t, k, d) { note('define-' + String(k)); return Reflect.defineProperty(t, k, d); } })",
  "new Proxy({ x: 1, y: 2 }, { set() { return false; } })",
  "new (class Other { x = 1; y = 2; })()",
  "new (class Accessors { #x = 1; get x() { return this.#x; } set x(v) { note('class-set-x:' + v); this.#x = v; } y = 2; })()",
  "[1, 2]",
  "new Uint8Array(2)",
  "'xy'",
  "5",
  "null",
  "undefined",
];

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const p = { x: i, y: 1 };
  warm += bump(p) + step(p) + halve(p);
  swap(p);
  reset(p);
}
console.log("2000 honest rounds", warm);

for (const text of texts) {
  let target: any = hidden(text);
  attempt("reset " + text, target, () => reset(target));
  target = hidden(text);
  attempt("bump " + text, target, () => bump(target));
  target = hidden(text);
  attempt("step " + text, target, () => step(target));
  target = hidden(text);
  attempt("swap " + text, target, () => swap(target));
  target = hidden(text);
  attempt("halve " + text, target, () => halve(target));
}

honest("honest after");
