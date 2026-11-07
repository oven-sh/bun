// Each function reads one property of one value, so the read shares its tests with nobody. Built as a very large program, in which all of them are cold:
// such a read tests its receiver, loads the slot, and reads by name whatever fails a test.
// Flags: --aot-limit=MaxWarmCodeValues:1
interface Point { x: number; y?: number; label: string; next: Point | undefined }
function outside(text: string): any { return JSON.parse(text); }
function readX(p: Point) { return p.x; }
function readY(p: Point) { return p.y; }
function readLabel(p: Point) { return p.label; }
function readNext(p: Point) { return p.next; }

class Holder { value: number; constructor(v: number) { this.value = v; } }
class Heir extends Holder { other = 2; }
function readValue(h: Holder) { return h.value; }

// The same name at another place in each of them.
class First { size = 1; a = "a"; }
class Second { a = "a"; size = 2; }
class Third { a = "a"; b = "b"; c = "c"; size = 3; }
function readSize(v: First | Second | Third) { return v.size; }

// A field that holds a closure, and one that holds an object written in place.
class Callbacks { step = 0; run = () => ++this.step; inner = { depth: 1, name: "inner" }; }
function readRun(c: Callbacks) { return c.run; }
function readInner(c: Callbacks) { return c.inner; }

// The object gets out before its constructor has filled it.
const unfinished: any[] = [];
class Leaks { early: number; late: string; constructor() { unfinished.push(readLate(this), readEarly(this)); this.early = 1; unfinished.push(readLate(this), readEarly(this)); this.late = "late"; } }
function readEarly(l: Leaks) { return l.early; }
function readLate(l: Leaks) { return l.late; }

const own: Point = { x: 1, label: "own", next: undefined };
const full: Point = { x: 2, y: 3, label: "full", next: own };
const deleted: any = { x: 7, y: 8, label: "deleted", next: undefined }; delete deleted.x; delete deleted.label;
const redefined: any = { x: 7, y: 8, label: "redefined", next: undefined }; Object.defineProperty(redefined, "x", { get() { return "now a getter"; } });
const extended: any = { x: 9, label: "extended", next: undefined }; extended.extra = 1; extended.y = 11;
const underAnother: any = { x: 12, label: "under another", next: undefined }; delete underAnother.x; Object.setPrototypeOf(underAnother, { x: "from the new prototype", y: "y from there" });
const holderUnderAnother: any = new Holder(6); delete holderUnderAnother.value; Object.setPrototypeOf(holderUnderAnother, { get value() { return "getter above"; } });
const sealed: Point = Object.seal({ x: 13, label: "sealed", next: undefined });
const callbacks = new Callbacks();
const replacedRun: any = new Callbacks(); replacedRun.run = "no function"; replacedRun.inner = 5;
const values: any[] = [
  own, full,
  outside('{"x":10,"label":"parsed","next":null}'),
  { get x() { return "getter"; }, get y() { return "gy"; }, get label() { return 7; }, get next() { return "gn"; }, get value() { return "gv"; }, get size() { return "gs"; } },
  new Proxy({}, { get(_, name) { return "proxy:" + String(name); } }),
  Object.create({ x: "inherited", y: "iy", label: "il", next: "in", value: "iv", size: "is", run: "ir", inner: "ii", early: "ie", late: "ila" }),
  Object.freeze({ x: 5, y: 6, label: "frozen", next: undefined }),
  "text", 42, true, Symbol.iterator, 10n, [1, 2], () => 1,
  deleted, redefined, extended, underAnother, holderUnderAnother, sealed,
  new Holder(4), new Heir(5), new First(), new Second(), new Third(), callbacks, replacedRun, new Leaks(),
  null, undefined,
];
function show(value: unknown): string {
  if (typeof value === "function") return "function:" + String((value as () => unknown)());
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
const handlers: Record<string, (value: any) => unknown> = { readX, readY, readLabel, readNext, readValue, readSize, readRun, readInner, readEarly, readLate };
for (const name of Object.keys(handlers)) {
  const read = handlers[name]!;
  const out: string[] = [];
  for (const value of values) {
    try { out.push(show(read(value))); } catch (error) { out.push((error as Error).constructor.name); }
  }
  console.log(name, out.join(" | "));
}
console.log(unfinished.map(String).join(" | "), callbacks.step);
