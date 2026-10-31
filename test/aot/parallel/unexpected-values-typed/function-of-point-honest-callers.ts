// A function of a point has honest callers and one from any.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
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

interface Point {
  x: number;
  y: number;
}

function sum(p: Point): number {
  return p.x + p.y;
}

const difference = (p: Point): number => p.x - p.y;

function backwards(p: Point): number {
  const y = p.y;
  const x = p.x;
  return x * 10 + y;
}

function looped(p: Point): number {
  let result = 0;
  for (let i = 0; i < 3; i++) {
    try {
      result += p.x * i + p.y;
    } finally {
      result += 1;
    }
  }
  return result;
}

function unpacked({ x, y }: Point): number {
  return x / y;
}

class Segment {
  constructor(
    public from: Point,
    public to: Point,
  ) {}
  span(): number {
    return sum(this.to) - sum(this.from) + difference(this.from);
  }
}

function honest(label: string): void {
  const kept: Point = { x: 3, y: 4 };
  const other = { y: 1.5, x: 2 };
  console.log(label, sum({ x: 1, y: 2 }), sum(kept), sum(other), difference(kept), backwards(other), looped(kept), unpacked(kept), new Segment(kept, other).span());
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

const texts = [
  "{ x: 1, y: 2 }",
  "{ y: 2, x: 1 }",
  "{ z: 3, x: 1, y: 2 }",
  "{ x: 1 }",
  "{ y: 2 }",
  "{}",
  "{ x: '1', y: 2 }",
  "{ x: 1, y: '2' }",
  "{ x: 1n, y: 2n }",
  "{ x: 1n, y: 2 }",
  "{ x: null, y: undefined }",
  "{ x: -0, y: -0 }",
  "{ x: 0.5, y: 1e308 }",
  "{ x: 2147483647, y: 1 }",
  "{ x: true, y: [] }",
  "{ x: { valueOf() { note('x.valueOf'); return 1; } }, y: { valueOf() { note('y.valueOf'); return 2; } } }",
  "{ x: { [Symbol.toPrimitive](hint) { note('x:' + hint); return 1; } }, y: { toString() { note('y.toString'); return '2'; } } }",
  "{ get x() { note('get-x'); return 1; }, get y() { note('get-y'); return 2; } }",
  "{ get x() { throw new RangeError('x'); }, y: 2 }",
  "{ get x() { delete this.y; return 1; }, y: 2 }",
  "{ get x() { this.y = 'changed'; return 1; }, y: 2 }",
  "{ x: 1, get y() { return this.x++; } }",
  "Object.create({ x: 1, y: 2 })",
  "Object.create({ get x() { note('inherited-get-x'); return 1; }, y: 2 })",
  "Object.assign(Object.create(null), { x: 1, y: 2 })",
  "Object.freeze({ x: 1, y: 2 })",
  "Object.defineProperty({ y: 2 }, 'x', { value: 1 })",
  "new Proxy({ x: 1, y: 2 }, { get(t, k, r) { note('get-' + String(k)); return Reflect.get(t, k, r); }, has(t, k) { note('has-' + String(k)); return k in t; } })",
  "new Proxy({}, { get() { return 6; } })",
  "new (class Other { x = 1; y = 2; })()",
  "new (class Accessors { get x() { note('class-get-x'); return 1; } get y() { return 2; } })()",
  "[1, 2]",
  "Object.assign([], { x: 1, y: 2 })",
  "Object.assign(function () {}, { x: 1, y: 2 })",
  "Object.assign(new Map(), { x: 1, y: 2 })",
  "'xy'",
  "5",
  "true",
  "Symbol()",
  "null",
  "undefined",
];

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const p = { x: i, y: 1 };
  warm += sum(p) + difference(p) + backwards(p) + looped(p) + unpacked(p);
}
console.log("2000 honest rounds", warm);

for (const text of texts) {
  attempt("sum " + text, () => sum(hidden(text)));
  attempt("difference " + text, () => difference(hidden(text)));
  attempt("backwards " + text, () => backwards(hidden(text)));
  attempt("looped " + text, () => looped(hidden(text)));
  attempt("unpacked " + text, () => unpacked(hidden(text)));
  attempt("span " + text, () => new Segment(hidden(text), { x: 1, y: 1 }).span());
}

honest("honest after");
