// `{ ...defaults, ...record }`, `Object.assign({}, defaults, record)` and `Object.assign(target, record)` where the record is an object of a written type and the code that copies knows nothing of it. The copy has what plain Bun gives it, in that order, whatever the record has been through; and copying records of one type onto targets of one shape takes a plan that is made once.
// Env: JSC_aotCountsPath=/dev/null
declare const aotRuntimeCounters: undefined | (() => string);
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
const countsSoFar = (): string => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for, but for the operations named.
function callsIn(counts: string, ...besides: string[]): number {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && !besides.includes(name)) sum += Number(calls);
  }
  return sum;
}
interface Inner { v: number }
interface Row { count: number; ratio: number; ok: boolean; name: string; inner: Inner; any: unknown; maybe?: number; other?: string; nothing: number | undefined; none: Inner | null }
const make = (i: number): Row => ({ count: i, ratio: i + 0.5, ok: i % 2 === 0, name: "n" + i, inner: { v: i }, any: i, nothing: undefined, none: null });
const withOptional = (i: number): Row => ({ ...make(i), maybe: i, other: "o" });
const otherOrder = (i: number): Row => ({ none: null, nothing: 1, any: "a", inner: { v: i }, name: "n", ok: true, ratio: 1, count: i });
const show = (o: any): string => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k)!; return String(k) + ":" + ("value" in d ? JSON.stringify(d.value) ?? "undefined" : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(",");
const attempt = (f: () => unknown): string => { try { return String(f()); } catch (e: any) { return e.constructor.name; } };
function spreadSecond(first: any, second: any): any { return { ...first, ...second }; }
function spreadBetween(first: any, second: any): any { return { a: 1, ...first, b: 2, ...second, c: 3 }; }
function assignSecond(first: any, second: any): any { return Object.assign({}, first, second); }
function assignOnto(target: any, source: any): any { return Object.assign(target, source); }
const calls: string[] = [];
const firsts: [string, () => any][] = [
  ["two others", () => JSON.parse('{"d0":0,"d1":1}')],
  ["nothing", () => ({})],
  ["the same names", () => JSON.parse('{"name":"first","count":-1,"zz":9}')],
  ["a record", () => make(7)],
  ["many", () => { const o: any = {}; for (let i = 0; i < 12; i++) o["m" + i] = i; return o; }],
];
const records: [string, () => any][] = [
  ["as made", () => make(1)],
  ["with the optional ones", () => withOptional(2)],
  ["in another order", () => otherOrder(3)],
  ["frozen", () => Object.freeze(make(4))],
  ["with an extra", () => { const r: any = make(5); r.extra = "e"; return r; }],
  ["with a symbol", () => { const r: any = make(6); r[Symbol.for("s")] = "s"; return r; }],
  ["one deleted", () => { const r: any = withOptional(7); delete r.maybe; return r; }],
  ["one deleted and added", () => { const r: any = withOptional(8); delete r.maybe; r.maybe = 80; return r; }],
  ["stored to", () => { const r = make(9); r.count = 90; r.ratio = 9; r.nothing = 5; r.none = { v: 1 }; r.any = { deep: [1] }; return r; }],
];
for (let turn = 0; turn < 2; turn++) for (const [f, first] of firsts) for (const [r, record] of records) {
  console.log(turn, f, "<-", r, "|", show(spreadSecond(first(), record())), "|", show(spreadBetween(first(), record())), "|", show(assignSecond(first(), record())), "|", show(assignOnto(first(), record())));
}
const targets: [string, () => any][] = [
  ["a setter", () => ({ p: 0, set count(v: number) { calls.push("set count " + v); } })],
  ["inherits a setter", () => Object.create({ set name(v: string) { calls.push("inherited set name " + v); } })],
  ["read-only", () => Object.defineProperty({ p: 0 }, "ok", { value: "fixed", writable: false, enumerable: true, configurable: true })],
  ["frozen", () => Object.freeze({ p: 0 })],
  ["closed", () => Object.preventExtensions({ p: 0, count: 0 })],
  ["a record", () => make(20)],
  ["an array", () => [1]],
];
for (let turn = 0; turn < 2; turn++) for (const [t, target] of targets) { const before = calls.length, into = target(); console.log(turn, t, attempt(() => assignOnto(into, make(3)) === into), show(into), calls.slice(before).join()); }
const same = make(1), copy = spreadSecond({}, same);
console.log(copy.inner === same.inner, copy !== same, Object.getPrototypeOf(copy) === Object.prototype);
const start = countsSoFar();
let sum = 0;
for (let i = 0; i < 2000; i++) { const r = make(i); sum += spreadSecond(firsts[0][1](), r).count + assignSecond(firsts[0][1](), r).count + assignOnto(JSON.parse('{"p":1}'), r).count; }
// `make` writes a number into a name.
const end = countsSoFar();
console.log(sum, callsIn(end, "operationAOTIntToString") - callsIn(start, "operationAOTIntToString") <= 100);
