// The places that throw in typed code where the message or a column is not that of plain Bun: see docs/bundler/aot-compatibility.mdx#error-messages and docs/bundler/aot-debugging.mdx#stack-traces. The class and the line are the same.
const opaque = <T,>(value: T): T => [value, value][Number(process.argv.length > 100)];
function framesOf(stack: unknown, count: number): string {
  const frames: string[] = [];
  for (const text of String(stack).split("\n")) {
    const frame = /^\s*at (?:(async )?(.*?) \()?([^()]*?)(?::(\d+):(\d+))?\)?$/.exec(text);
    if (!frame) continue;
    const file = frame[3].replace(/^.*[\\/]/, "");
    frames.push((frame[1] ?? "") + (frame[2] ?? "") + "@" + file + (frame[4] ? ":" + frame[4] + ":" + frame[5] : ""));
  }
  return frames.slice(0, count).join(" | ");
}
function describe(thrown: unknown): string {
  if (!(thrown instanceof Error)) return "no error: " + String(thrown);
  const error: any = thrown;
  return error.name + ": " + error.message + " [" + error.line + ":" + error.column + "] " + framesOf(error.stack, 3);
}
function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "-> no throw", String(run()));
  } catch (error) {
    console.log(label, "->", describe(error));
  }
}

class Point {
  x: number;
  y: number;
  next: Point | null = null;
  label?: string;
  tags: string[] | null = null;
  scale: ((factor: number) => number) | null = null;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  length(): number {
    return Math.hypot(this.x, this.y);
  }
  get first(): string {
    return this.tags![0];
  }
  static origin: Point | null = null;
}
interface Shape {
  name: string;
  center: Point | null;
  area?: () => number;
  inner?: { depth: number; deeper?: { value: string } };
}
const point = opaque(new Point(1, 2));
const noPoint = opaque<Point | null>(null);
const missingPoint = opaque<Point | undefined>(undefined);
const shape = opaque<Shape>({ name: "shape", center: null });
const noList = opaque<number[] | null>(null);
const noText = opaque<string | null>(null);
const noMap = opaque<Map<string, number> | null>(null);
const noSet = opaque<Set<number> | undefined>(undefined);
const noFunction = opaque<((value: number) => number) | null>(null);
const points = opaque<(Point | null)[]>([null]);
const table = opaque<Record<string, Point | undefined>>({});
const pair = opaque<[Point | null, number]>([null, 1]);

function readX(p: Point): number { return p.x; }
function readTwice(p: Point): number { const x = readX(p); return x + 1; }
class Thrower {
  constructor(fails = false) { if (fails) throw new RangeError("in a constructor"); }
  method(): never { throw new TypeError("in a method"); }
  get getter(): number { throw new EvalError("in a getter"); }
  static make(): Thrower { throw new URIError("in a static method"); }
}
class ThrowsInField { field: number = fail("in a field initializer"); }
function fail(message: string): never { throw new Error(message); }
function generic<T>(value: T): T { if (opaque(true)) throw new Error("in a generic function " + typeof value); return value; }
class Failure extends Error { code: number; constructor(message: string, code: number) { super(message); this.name = "Failure"; this.code = code; } }
enum Color { Red, Green }
function lookup(color: Color): string { switch (color) { case Color.Red: return "red"; case Color.Green: return "green"; default: throw new RangeError("no color " + color); } }
function unreachable(value: never): never { throw new Error("reached with " + String(value)); }

// Fields of typed objects.
attempt("field of null", () => { noPoint!.x; });
attempt("field of undefined", () => { missingPoint!.x; });
attempt("second field of null", () => { noPoint!.y; });
attempt("field of a field", () => { point.next!.x; });
attempt("field of a field of a field", () => { point.next!.next!.x; });
attempt("field of an interface member", () => { shape.center!.x; });
attempt("optional member of an interface", () => { shape.inner!.depth; });
attempt("deep optional member", () => { shape.inner!.deeper!.value; });
attempt("field of a static", () => { Point.origin!.x; });
attempt("field of an element", () => { points[0]!.x; });
attempt("field of a record member", () => { table.absent!.x; });
attempt("field of a tuple member", () => { pair[0]!.x; });
attempt("field in arithmetic", () => { noPoint!.x + noPoint!.y; });
attempt("field as an argument", () => { Math.abs(noPoint!.x); });
attempt("field returned", () => noPoint!.x);
attempt("field in a loop", () => { let sum = 0; for (let i = 0; i < 3; i++) sum += noPoint!.x; return sum; });
attempt("field through a parameter", () => { ((p: Point) => p.x)(noPoint as Point); });
attempt("field through a typed function", () => { readX(noPoint as Point); });
attempt("field through two typed functions", () => { readTwice(noPoint as Point); });
attempt("optional string member", () => { point.label!.length; });

// Stores.
attempt("store to null", () => { noPoint!.x = 1; });
attempt("store to undefined", () => { missingPoint!.x = 1; });
attempt("store to a field of a field", () => { point.next!.x = 1; });
attempt("compound store", () => { noPoint!.x += 1; });
attempt("increment", () => { noPoint!.x++; });
attempt("store to an element of null", () => { noList![0] = 1; });
attempt("store of an object field", () => { noPoint!.next = point; });

// Calls.
attempt("method of null", () => { noPoint!.length(); });
attempt("method of undefined", () => { missingPoint!.length(); });
attempt("method of a field", () => { point.next!.length(); });
attempt("getter of null", () => { noPoint!.first; });
attempt("getter that reads null", () => { point.first; });
attempt("function field that is null", () => { point.scale!(2); });
attempt("function variable that is null", () => { noFunction!(1); });
attempt("method in tail position", () => noPoint!.length());
attempt("function field in tail position", () => point.scale!(2));
attempt("new of null", () => { new (opaque<typeof Point | null>(null))!(1, 2); });

// Built-in receivers.
attempt("length of a null array", () => { noList!.length; });
attempt("element of a null array", () => { noList![0]; });
attempt("push on a null array", () => { noList!.push(1); });
attempt("map on a null array", () => { noList!.map(value => value); });
attempt("for-of over a null array", () => { for (const value of noList!) return value; });
attempt("destructuring of a null array", () => { const [first] = noList!; return first; });
attempt("length of a null string", () => { noText!.length; });
attempt("method of a null string", () => { noText!.toUpperCase(); });
attempt("character of a null string", () => { noText![0]; });
attempt("get on a null Map", () => { noMap!.get("a"); });
attempt("set on a null Map", () => { noMap!.set("a", 1); });
attempt("size of a null Map", () => { noMap!.size; });
attempt("has on an undefined Set", () => { noSet!.has(1); });
attempt("destructuring of a null field", () => { const { next: { x } } = point as { next: Point }; return x; });
attempt("destructured parameter", () => { (({ x }: Point) => x)(noPoint as Point); });

// What the program throws.
attempt("throw in a field initializer", () => { new ThrowsInField(); });
