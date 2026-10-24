// As a-callee-keeps-the-callback-on-some-paths.ts, for the other ways into a function and the other ways a parameter goes on inside it: constructors, methods, setters, static members, defaults,
// a parameter that is assigned again, call | apply | bind | spread, try | catch | finally, a function of its own that captures it, two parameters that may be one value.
type Callback = (n: number) => number;
const kept: Callback[] = [];
const lines: string[] = [];
function say(name: string, ...values: unknown[]) { lines.push(name + " " + values.join(" ")); }
function keepIf(cb: Callback, keep: boolean): Callback | undefined { if (keep) { kept.push(cb); return cb; } return undefined; }

class Listener { cb: Callback | undefined = undefined; constructor(cb: Callback, keep: boolean) { if (keep) this.cb = cb; } }
class Child extends Listener { again: Callback | undefined; constructor(cb: Callback, keep: boolean, more: boolean) { super(cb, keep); this.again = more ? cb : undefined; } }
class Registry {
  list: Callback[] = [];
  static last: Callback | undefined;
  #hidden: Callback | undefined;
  add(cb: Callback, keep: boolean): this { if (keep) this.list.push(cb); return this; }
  static note(cb: Callback, keep: boolean): number { if (keep) Registry.last = cb; return cb(1); }
  set handler(cb: Callback) { if (cb(0) % 3 === 0) this.#hidden = cb; }
  get handler(): Callback { return this.#hidden!; }
}
function assignedAgain(cb: Callback, wrap: boolean, keep: boolean): number { if (wrap) { const inner = cb; cb = n => inner(n) + 1; } if (keep) kept.push(cb); return cb(1); }
function defaulted(keep: boolean, cb: Callback = n => n * 2): number { if (keep) kept.push(cb); return cb(1); }
function byCall(cb: Callback, keep: boolean) { return keepIf.call(undefined, cb, keep); }
function byApply(cb: Callback, keep: boolean) { return keepIf.apply(undefined, [cb, keep]); }
function byBind(cb: Callback, keep: boolean) { return keepIf.bind(undefined, cb)(keep); }
function bySpread(cb: Callback, keep: boolean) { const list: [Callback, boolean] = [cb, keep]; return keepIf(...list); }
function tries(cb: Callback, how: number): number {
  try { if (how === 1) throw cb; if (how === 2) return cb(1); return 0; } catch (e) { kept.push(e as Callback); return -1; } finally { if (how === 3) kept.push(cb); }
}
function ownFunction(cb: Callback, keep: boolean): Callback | undefined { function inner() { return keep ? cb : undefined; } return inner(); }
function sameTwice(a: Callback, b: Callback, keep: boolean): boolean { if (keep) { kept.push(a); kept.push(b); return kept[kept.length - 1] === kept[kept.length - 2]; } return a === b; }
function conditional(cb: Callback, other: Callback | undefined, keep: boolean): Callback | undefined { const c = other ?? cb; return keep ? c : undefined; }
function inLoopWithBreak(cb: Callback, n: number): number { let r = 0; for (let i = 0; i < 5; i++) { if (i === n) { kept.push(cb); break; } r += cb(i); } return r; }
function symbolKey(cb: Callback, keep: boolean): unknown { const o: Record<symbol, unknown> = {}; if (keep) o[Symbol.iterator] = cb; return o[Symbol.iterator]; }

const rounds = 2000;
{ let n = 0, t = 0; for (let i = 0; i < rounds; i++) { const l = new Listener(x => x + i, i % 7 === 0); if (l.cb) { n++; t += l.cb(0); } } say("constructor", n, t); }
{ let t = 0, same = 0; for (let i = 0; i < rounds; i++) { const c = new Child(x => x + i, i % 2 === 0, i % 3 === 0); if (c.cb && c.again && c.cb === c.again) same++; t += (c.cb?.(0) ?? 0) + (c.again?.(0) ?? 0); } say("derived", same, t); }
{ const r = new Registry(); for (let i = 0; i < rounds; i++) r.add(x => x + i, i % 9 === 0).add(x => x - i, i % 10 === 0); say("method", r.list.length, r.list.reduce((a, f) => a + f(0), 0), new Set(r.list).size); }
{ let t = 0; for (let i = 0; i < rounds; i++) t += Registry.note(x => x + i, i % 11 === 0); say("static", t, Registry.last!(0)); }
{ const r = new Registry(); let t = 0; for (let i = 0; i < rounds; i++) { r.handler = x => x + i; t += r.handler(0); } say("setter", t); }
{ let t = 0; for (let i = 0; i < rounds; i++) t += assignedAgain(x => x + i, i % 2 === 0, i % 5 === 0); say("assigned again", t, kept.length); }
{ let t = 0; for (let i = 0; i < rounds; i++) t += i % 2 ? defaulted(i % 6 === 1) : defaulted(i % 6 === 0, x => x + i); say("default", t, kept.length); }
{ let n = 0; for (let i = 0; i < rounds; i++) for (const f of [byCall, byApply, byBind, bySpread]) { const r = f(x => x + i, i % 13 === 0); if (r && r === kept[kept.length - 1] && r(0) === i) n++; } say("call apply bind spread", n); }
{ let t = 0; for (let i = 0; i < rounds; i++) t += tries(x => x + i, i % 5); say("try", t, kept.length, kept[kept.length - 1](0)); }
{ let t = 0; for (let i = 0; i < rounds; i++) { const r = ownFunction(x => x + i, i % 8 === 0); if (r) t += r(0); } say("own function", t); }
{ let t = 0; for (let i = 0; i < rounds; i++) { const f: Callback = x => x + i; if (sameTwice(f, f, i % 4 === 0)) t++; if (sameTwice(x => x, x => x, i % 4 === 1)) t += 1000; } say("same twice", t); }
{ let t = 0; let last: Callback | undefined; for (let i = 0; i < rounds; i++) { const r = conditional(x => x + i, i % 3 === 0 ? last : undefined, i % 2 === 0); if (r) { t += r(0); last = r; } } say("conditional", t); }
{ let t = 0; for (let i = 0; i < rounds; i++) t += inLoopWithBreak(x => x + i, i % 8); say("break", t, kept.length); }
{ let t = 0; for (let i = 0; i < rounds; i++) { const r = symbolKey(x => x + i, i % 20 === 0); if (typeof r === "function") t += (r as Callback)(0); } say("symbol", t); }
say("all", kept.length, new Set(kept).size, kept.reduce((a, f) => a + f(0), 0));
console.log(lines.join("\n"));
