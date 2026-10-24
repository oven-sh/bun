// Functions that return a fresh object literal, whose callers destructure it, read some of it, keep it, or never look at it.
const say = (what: string, got: unknown) => console.log(what + ": " + (typeof got === "string" ? got : JSON.stringify(got) ?? String(got)));
const keep: unknown[] = []; let spins = 0;
const busy = (n: number) => { let s = 0; for (let i = 0; i < (n & 3) + 1; i++) { s += i * 3; if (s > 1e9) s = 0; spins++; } for (let j = 0; j < 2; j++) { s ^= j; if (s < -1e9) s = 1; } return s; };
function divmod(a: number, b: number) { let q = 0, r = a; while (r >= b) { r -= b; q++; if (q > 1e9) break; } for (let i = 0; i < 2; i++) spins += i; return { q, r }; }
function minmax(list: number[]) { let lo = Infinity, hi = -Infinity, n = 0; for (const x of list) { if (x < lo) lo = x; if (x > hi) hi = x; n++; } for (let i = 0; i < 2; i++) spins += i; return { lo, hi, n }; }
function parse(text: string) {
  if (!text) { busy(1); return { ok: false, value: 0, rest: "" }; }
  let i = 0, value = 0; while (i < text.length && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) { value = value * 10 + text.charCodeAt(i) - 48; i++; }
  if (!i) { busy(2); return { ok: false, value: -1, rest: text }; }
  busy(3); return { ok: true, value, rest: text.slice(i) };
}
function kinds(n: number) { busy(n); busy(n + 1); return { s: "s" + n, i: n | 0, d: n + 0.5, b: n > 1, o: { in: n }, a: [n], u: undefined, f: () => n * 2 }; }
function one(n: number) { let s = 0; for (let i = 0; i <= n; i++) { s += i; if (s > 1e9) s = 0; } for (let i = 0; i < 2; i++) spins += i; return { only: s }; }
function fib(n: number): { a: number; b: number } { busy(n); if (n === 0) return { a: 0, b: 1 }; const { a, b } = fib(n - 1); busy(n); return { a: b, b: a + b }; }
function sometimesThrows(n: number) { busy(n); busy(n); if (n === 3) throw new RangeError("three"); return { n, twice: n * 2 }; }
function intsOrDoubles(n: number) { busy(n); busy(n); return { v: n % 2 ? n : n + 0.25, w: n % 2 ? "odd" : n }; }
say("destructured", (() => { const { q, r } = divmod(17, 5); const { lo, hi, n } = minmax([3, 1, 4, 1, 5]); return [q, r, lo, hi, n]; })());
say("read by name", (() => { const d = divmod(29, 4); let s = 0; for (let i = 0; i < d.q; i++) s += d.r; return [d.q, d.r, s, d.q > 3 ? d.r : d.q]; })());
say("some of them", (() => { const { r } = divmod(9, 2); const m = minmax([2]); divmod(1, 1); return [r, m.n]; })());
say("several ways out", [parse(""), parse("x1"), parse("42rest")].length + " " + (() => { const a = parse(""), b = parse("x1"), c = parse("42rest"); return [a.ok, a.value, a.rest, b.ok, b.value, b.rest, c.ok, c.value, c.rest].join(); })());
say("of every kind", (() => { const { s, i, d, b, o, a, u, f } = kinds(2); return [s, i, d, b, o, a, u === undefined, f(), typeof f]; })());
say("just one", (() => { const { only } = one(4); return only + one(3).only; })());
say("calls itself", (() => { const { a, b } = fib(20); return [a, b]; })());
say("under other names, with something to fall back on", (() => { const { q: quotient, r: remainder = 7 } = divmod(8, 3); const { u = "fallback", s: text = "no" } = kinds(1); return [quotient, remainder, u, text]; })());
say("taken apart further", (() => { const { o: { in: inner }, a: [first] } = kinds(5); return [inner, first]; })());
say("throws", (() => { const out: unknown[] = []; for (let i = 1; i < 5; i++) { try { const { n, twice } = sometimesThrows(i); out.push(n + twice); } catch (e) { out.push((e as Error).message); } } return out; })());
say("now one kind of thing, now another", (() => { const out: unknown[] = []; for (let i = 0; i < 4; i++) { const { v, w } = intsOrDoubles(i); out.push(v, w, typeof w); } return out; })());
say("in the arguments of another", (() => Math.max(divmod(20, 3).q, divmod(20, 3).r) + divmod(divmod(100, 7).q, divmod(100, 7).r).q)());
function wantedByOne(n: number) { busy(n); busy(n); return { a: n, b: n + 1 }; }
say("wanted by one of those who call it", (() => { const { a } = wantedByOne(1); keep.push(wantedByOne(2)); return [a, keep]; })());
function otherNames(n: number) { busy(n); busy(n); if (n) return { a: n, b: 1 }; return { a: n, c: 2 }; }
say("other names", (() => { const x = otherNames(1) as { a: number; b?: number; c?: number }, y = otherNames(0) as { a: number; b?: number; c?: number }; return [x.a, x.b, x.c, y.a, y.b, y.c]; })());
function otherOrder(n: number) { busy(n); busy(n); if (n) return { a: n, b: 1 }; return { b: 2, a: n }; }
say("another order", (() => { const x = otherOrder(1), y = otherOrder(0); return [x.a, x.b, y.a, y.b, Object.keys(otherOrder(0)).join()]; })());
function orNothing(n: number) { busy(n); busy(n); if (n) return { a: n }; return null; }
say("or nothing", (() => { const x = orNothing(1), y = orNothing(0); return [x?.a, y?.a, y === null]; })());
function orNothingSaid(n: number): { a: number } | undefined { busy(n); busy(n); if (n) return { a: n }; }
say("or nothing said", [orNothingSaid(1)?.a, orNothingSaid(0)?.a]);
function aVariable(n: number) { busy(n); busy(n); const o = { a: n, b: 2 }; o.b = 3; return o; }
say("changed first", (() => { const { a, b } = aVariable(1); return [a, b]; })());
function seenFirst(n: number) { busy(n); busy(n); const o = { a: n }; keep.push(o); return o; }
say("seen first", (() => { const { a } = seenFirst(5); return [a, keep.length]; })());
function handsOn(n: number) { busy(n); return divmod(n, 2); }
say("what another returns", (() => { const { q, r } = handsOn(9); return [q, r]; })());
async function later(n: number) { busy(n); busy(n); return { a: n, b: n + 1 }; }
later(1).then(({ a, b }) => say("after an await", [a, b]));
function* many(n: number) { busy(n); yield { a: n }; return { a: n + 1 }; }
say("a generator", (() => { const g = many(1); return [g.next(), g.next()]; })());
function asACallback(n: number) { busy(n); busy(n); return { a: n, b: n * n }; }
say("handed to something that calls it", [1, 2].map(asACallback).map(({ a, b }) => a + b));
function calledOtherwise(this: unknown, n: number) { busy(n); busy(n); return { a: n, t: typeof this }; }
say("called some other way", (() => { const { a } = calledOtherwise(1); const x = calledOtherwise.call("s", 2), y = calledOtherwise.apply(null, [3]), z = calledOtherwise.bind(4)(5), w = calledOtherwise(...([6] as [number])); return [a, x, y, z, w]; })());
function constructed(this: { own?: number }, n: number) { busy(n); busy(n); this.own = n; return { a: n }; }
say("constructed with", (() => { const o = new (constructed as any)(1); return [o, o.own]; })());
function missing(n: number) { busy(n); busy(n); return { a: n } as { a: number; z?: number }; }
say("asked for what is not there", (() => { const { a, z = 9 } = missing(1); return [a, z, typeof missing(2).toString]; })());
function nine(n: number) { busy(n); busy(n); return { a: n, b: n, c: n, d: n, e: n, f: n, g: n, h: n, i: n + 1 }; }
say("too many", (() => { const { a, i } = nine(1); return [a, i]; })());
function withMore(n: number) { busy(n); busy(n); return { a: n, ...(n ? { b: 1 } : {}) }; }
say("with more spread in", (() => { const { a } = withMore(1); return a; })());
function withGetter(n: number) { busy(n); busy(n); let c = 0; return { a: n, get b() { return ++c; } }; }
say("with a getter", (() => { const o = withGetter(1); return [o.a, o.b, o.b]; })());
function written(n: number) { busy(n); busy(n); return { a: n, b: 0 }; }
say("written to by who called", (() => { const o = written(1); o.b = 5; return [o.a, o.b]; })());
function compared(n: number) { busy(n); busy(n); return { a: n }; }
say("compared", (() => { const x = compared(1), y = compared(1); return [(x as unknown) === y, x === x, x.a]; })());
function inAClosure(n: number) { busy(n); busy(n); return { a: n }; }
say("kept by a closure", (() => { const o = inAClosure(3); const f = () => o.a; return f(); })());
function oneOfTwo(n: number) { busy(n); busy(n); return { a: n }; }
say("one of two", ((c: boolean) => { const o = c ? oneOfTwo(1) : oneOfTwo(2); return o.a; })(true));
class C { v = 2; pair(n: number) { busy(n); busy(n); return { a: n, v: this.v }; } }
say("a method", (() => { const { a, v } = new C().pair(1); return [a, v]; })());
{ let s = 0; for (let i = 1; i < 20000; i++) { const { q, r } = divmod(i & 63, 7); const { ok, value } = parse(String(i & 15)); s += q + r + (ok ? value : 0); } say("many times", s); }
say("spins", spins > 0);
export {};
