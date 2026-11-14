// The places that throw in typed code: the class, the whole message, the line and column, and the first frames of the stack are those of plain Bun.
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

// Calls.
attempt("optional method that is missing", () => { shape.area!(); });
attempt("optional method in tail position", () => shape.area!());
attempt("method that a cast invents", () => { (point as any).absent(); });
attempt("method that a cast invents, tail", () => (point as any).absent());

// Built-in receivers.
attempt("spread of a null array", () => { [...noList!]; });
attempt("destructuring of a null object", () => { const { x } = noPoint!; return x; });

// What the program throws.
attempt("throw in a method", () => { new Thrower().method(); });
attempt("throw in a constructor", () => { new Thrower(true); });
attempt("throw in a getter", () => { new Thrower().getter; });
attempt("throw in a static method", () => { Thrower.make(); });
attempt("throw in a generic function", () => { generic<number>(1); });
attempt("throw of a subclass", () => { throw new Failure("failed", 7); });
attempt("throw in an enum lookup", () => { lookup(opaque(5 as Color)); });
attempt("throw behind a never", () => { unreachable(opaque("x") as never); });
