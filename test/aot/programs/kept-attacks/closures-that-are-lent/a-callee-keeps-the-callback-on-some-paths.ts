// A callee keeps the callback it is given on some of its paths only, as a hook does that compares dependencies. Where it does not keep it nothing needs to be made for the callback. Where it does, there is
// ONE function object for the program to see, however often and by whomever it is kept, compared, looked into or called afterwards, and it holds what the callback captured in that round.
type Callback = (n: number) => number;
const kept: Callback[] = [];
let slot: Callback | undefined;
const lines: string[] = [];
function say(name: string, ...values: unknown[]) { lines.push(name + " " + values.join(" ")); }

function keepIf(cb: Callback, keep: boolean): Callback | undefined { if (keep) { kept.push(cb); return cb; } return undefined; }
function keepTwice(cb: Callback, keep: boolean): number { if (!keep) return 0; slot = cb; kept.push(cb); return slot === kept[kept.length - 1] ? 1 : 2; }
function keepThenCall(cb: Callback, keep: boolean): number { if (keep) slot = cb; return cb(1); }
function callThenKeep(cb: Callback, keep: boolean): number { const r = cb(1); if (keep) slot = cb; return r; }
type Memo = { cb: Callback | undefined; dep: number };
function memo(state: Memo, cb: Callback, dep: number): Callback { if (state.cb !== undefined && state.dep === dep) return state.cb; state.cb = cb; state.dep = dep; return cb; }
function handOn(cb: Callback, keep: boolean): Callback | undefined { return keepIf(cb, keep); }
function handOnTwice(cb: Callback, a: boolean, b: boolean): string { const x = keepIf(cb, a); const y = keepIf(cb, b); return (x === undefined ? "-" : "x") + (y === undefined ? "-" : "y") + (x === y ? "=" : "!"); }
function handOnThenKeep(cb: Callback, a: boolean, b: boolean): boolean { const x = keepIf(cb, a); if (b) slot = cb; return !a || !b || x === slot; }
function keepThenCompare(cb: Callback, keep: boolean): boolean { if (keep) slot = cb; return slot === cb; }
function compare(cb: Callback, other: Callback | undefined): boolean { return cb === other; }
function keepInLoop(cb: Callback, n: number): number { const from = kept.length; for (let i = 0; i < n; i++) kept.push(cb); return new Set(kept.slice(from)).size; }
function looksInto(cb: Callback, look: boolean): number { return look ? cb.length * 100 + cb.name.length : 0; }
function givesProperty(cb: Callback, give: boolean): number { if (give) (cb as any).mark = 7; return give ? (cb as any).mark : 0; }
function throwsIt(cb: Callback, t: boolean): number { if (t) throw cb; return 0; }
function capturesIt(cb: Callback, c: boolean): (() => number) | undefined { return c ? () => cb(2) : undefined; }
function asKey(cb: Callback, k: boolean, map: Map<Callback, number>): number { if (k) { map.set(cb, (map.get(cb) ?? 0) + 1); map.set(cb, (map.get(cb) ?? 0) + 1); } return map.size; }
function deep(cb: Callback, depth: number, keep: boolean): Callback | undefined { if (depth === 0) return keepIf(cb, keep); return deep(cb, depth - 1, keep); }
async function later(cb: Callback, keep: boolean): Promise<number> { await null; if (keep) kept.push(cb); return cb(3); }
function* steps(cb: Callback, keep: boolean): Generator<number | Callback> { yield cb(1); if (keep) yield cb; }
function testsIt(cb: Callback | number, keep: boolean): number { if (typeof cb !== "function") return -1; if (keep) slot = cb; const value: unknown = cb; return value ? 1 : 0; }
function intoLiteral(cb: Callback, keep: boolean): { run: Callback } | undefined { return keep ? { run: cb } : undefined; }
function boxed(cb: Callback): { run: Callback; note: undefined } { return { run: cb, note: undefined }; }
function lazily(cb: () => number) { return { get value(): number { const value = cb(); Object.defineProperty(this, "value", { value }); return value; } }; }
function oneOfTwo(a: Callback, b: Callback, which: number): Callback | undefined { const c = which & 1 ? a : b; return which & 2 ? c : undefined; }
function asReceiver(cb: Callback, keep: boolean): unknown { return keep ? Object.prototype.valueOf.call(cb) : undefined; }

const rounds = 3000;
let sum = 0;
{
  let same = 0, made = 0;
  for (let i = 0; i < rounds; i++) { const r = keepIf(n => n + i, i % 7 === 0); if (r) { made++; if (r === kept[kept.length - 1]) same++; sum += r(1); } }
  say("keepIf", made, same, kept.length, kept.reduce((a, f) => a + f(0), 0), new Set(kept).size);
}
{ let r = 0; for (let i = 0; i < rounds; i++) r += keepTwice(n => n + i, i % 5 === 0); say("keepTwice", r, slot!(0)); }
{ let r = 0; for (let i = 0; i < rounds; i++) r += keepThenCall(n => n + i, i % 3 === 0) + callThenKeep(n => n - i, i % 4 === 0); say("calls", r, slot!(0)); }
{
  const state: Memo = { cb: undefined, dep: -1 };
  let changes = 0; let last: Callback | undefined;
  for (let i = 0; i < rounds; i++) { const cb = memo(state, n => n * 1000 + i, i >> 4); if (cb !== last) changes++; last = cb; sum += cb(1); }
  say("memo", changes, last!(0), state.cb === last);
}
{ let n = 0; for (let i = 0; i < rounds; i++) if (handOn(x => x + i, i % 11 === 0) === kept[kept.length - 1]) n++; say("handOn", n); }
{ const seen = new Map<string, number>(); for (let i = 0; i < rounds; i++) { const s = handOnTwice(x => x + i, i % 2 === 0, i % 3 === 0); seen.set(s, (seen.get(s) ?? 0) + 1); } say("handOnTwice", [...seen].sort().join(";")); }
{ let ok = 0; for (let i = 0; i < rounds; i++) if (handOnThenKeep(x => x + i, i % 2 === 0, i % 3 === 0)) ok++; say("handOnThenKeep", ok); }
{ let t = 0; for (let i = 0; i < rounds; i++) if (keepThenCompare(x => x + i, i % 6 === 0)) t++; say("keepThenCompare", t); }
{ let t = 0; for (let i = 0; i < rounds; i++) if (compare(x => x + i, slot)) t++; say("compare", t); }
{ let t = 0; for (let i = 0; i < 300; i++) t += keepInLoop(x => x + i, i % 4); say("keepInLoop", t); }
{ let t = 0; for (let i = 0; i < rounds; i++) t += looksInto(function named(x) { return x + i; }, i % 9 === 0) + givesProperty(x => x + i, i % 8 === 0); say("looked into", t); }
{ let t = 0; for (let i = 0; i < rounds; i++) { try { t += throwsIt(x => x + i, i % 13 === 0); } catch (e) { t += (e as Callback)(1); } } say("thrown", t); }
{ let t = 0; for (let i = 0; i < rounds; i++) { const f = capturesIt(x => x + i, i % 10 === 0); if (f) t += f(); } say("captured", t); }
{ const map = new Map<Callback, number>(); let t = 0; for (let i = 0; i < rounds; i++) t += asKey(x => x + i, i % 100 === 0, map); say("keys", t, map.size, [...map.values()].every(v => v === 2)); }
{ let t = 0; for (let i = 0; i < rounds; i++) { const r = deep(x => x + i, i % 5, i % 17 === 0); if (r) t += r(0); } say("deep", t); }
{ let t = 0; for (let i = 0; i < rounds; i++) t += testsIt(i % 2 ? x => x + i : i, i % 6 === 1); say("tested", t, slot!(0)); }
{ let t = 0; for (let i = 0; i < rounds; i++) { const o = intoLiteral(x => x + i, i % 12 === 0); if (o) t += o.run(1); } say("literal", t); }
{ let t = 0; const boxes: { run: Callback }[] = []; for (let i = 0; i < rounds; i++) { const b = boxed(x => x + i); boxes[i & 15] = b; t += b.run(1) + boxes[(i >> 1) & 15 & (i > 40 ? 15 : 0)].run(0); } say("a fresh result", t); }
{ let t = 0; const all: { value: number }[] = []; for (let i = 0; i < rounds; i++) all.push(lazily(() => i * 2)); for (const one of all) t += one.value + one.value; say("lazily", t); }
{ let t = 0; for (let i = 0; i < rounds; i++) { const c = oneOfTwo(x => x + i, x => x - i, i & 3); if (c) t += c(0); } say("one of two", t); }
{ let t = 0; for (let i = 0; i < rounds; i++) { const r = asReceiver(x => x + i, i % 50 === 0); if (typeof r === "function") t += (r as Callback)(0); } say("receiver", t); }
{ let t = 0; for (let i = 0; i < 300; i++) for (const s of steps(x => x + i, i % 3 === 0)) t += typeof s === "number" ? s : s(0); say("generator", t); }
const waits: Promise<number>[] = [];
for (let i = 0; i < 300; i++) waits.push(later(x => x + i, i % 3 === 0));
say("async", (await Promise.all(waits)).reduce((a, b) => a + b, 0), kept.length, new Set(kept).size);
console.log(lines.join("\n"));
console.log(sum);
