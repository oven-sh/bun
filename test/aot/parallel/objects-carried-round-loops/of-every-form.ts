// Each turn of a loop makes an object and hands it to the next. The next turn reads its fields, and some turns keep it, compare it, write it, hand it on, or leave with it.
type Q = { value: any; done: boolean };
function make(value: any, done: boolean): Q { return { value, done }; }
class P { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } plus(o: P): P { return new P(this.x + o.x, this.y + o.y); } get length(): number { return Math.hypot(this.x, this.y); } }
class P3 extends P { z: number; constructor(x: number, y: number, z: number) { super(x, y); this.z = z; } }
const kept: any[] = [], log: string[] = [];
const starts: any[] = [0, -0, 1.5, 2147483646, 9007199254740990, NaN, Infinity, "7", "a", null, undefined, true, 5n];

const loops: Record<string, (start: any, n: number) => any> = {
  iterates(start, n) { let s = 0, k = 0; for (let q = make(start, false); !q.done; q = make(k, k >= n)) { s += q.value; k++; } return s; },
  counts(start, n) { let q = make(start, n <= 0); while (!q.done) q = make(q.value + 1, q.value + 2 > n); return q.value; },
  typed(start, n) { let s = 0; for (let q: { v: number } = { v: 0 }; q.v < n; q = { v: q.v + 1 }) s = (s + q.v) | 0; return s; },
  fraction(start, n) { let s = 0; for (let q = { v: 0 }; q.v < n; q = { v: q.v + 0.5 }) s += q.v; return s; },
  overflows(start, n) { let q = { v: 2147483640 }; for (let i = 0; i < n; i++) q = { v: q.v + 3 }; return q.v; },
  leavesIntegers(start, n) { let q = { v: 1 }; for (let i = 0; i < n; i++) q = { v: i === 3 ? 0.25 : q.v + 1 }; return q.v; },
  negativeZero(start, n) { let q = { v: 0 }; let zeros = ""; for (let i = 0; i < n; i++) { zeros += Object.is(q.v, -0) ? "-" : "+"; q = { v: -q.v }; } return zeros; },
  exchanges(start, n) { let a = { v: 1 }, b = { v: 2 }; for (let i = 0; i < n; i++) { const c = { v: (a.v + b.v) & 1023 }; a = b; b = c; } return a.v * 10000 + b.v; },
  swaps(start, n) { let a = { v: 1, w: "a" }, b = { v: 2, w: "b" }; let t = ""; for (let i = 0; i < n; i++) { t += a.w + b.v; const c = a; a = b; b = c; if (i % 3 === 2) a = { v: i, w: "n" }; } return t + a.w + b.w; },
  points(start, n) { let p = new P(0, 0); const d = new P(0.5, 0.25); for (let i = 0; i < n; i++) p = p.plus(d); return p.x + "," + p.y + "," + p.length.toFixed(3); },
  mixedClasses(start, n) { let p: P = new P(1, 2); for (let i = 0; i < n; i++) p = i & 1 ? new P3(p.y, p.x, i) : new P(p.y + 1, p.x); return p.x + "," + p.y + "," + (p instanceof P3); },
  keeps(start, n) { let s = 0; for (let q = make(0, false), k = 0; !q.done; q = make(++k, k >= n)) { if (k === 2) kept.push(q); s += q.value; } const held = kept.splice(0); return s + " " + JSON.stringify(held); },
  keepsAndWrites(start, n) { let t = ""; for (let q = make(0, false), k = 0; !q.done; q = make(++k, k >= n)) { if (k === 1) { kept.push(q); kept[0].value = "written"; } t += q.value + ";"; } kept.length = 0; return t; },
  writes(start, n) { let q = { v: 1, n: 0 }, s = 0; for (let i = 0; i < n; i++) { q.n++; q.v += q.n; s += q.v; if ((i & 3) === 3) q = { v: i, n: 0 }; } return s + q.v; },
  writesOther(start, n) { let a = { v: 1 }, b = a, s = ""; for (let i = 0; i < n; i++) { b.v += 10; s += a.v + ","; if (i & 1) a = { v: i }; else b = a; } return s; },
  identity(start, n) { let q = { v: 0 }, last: any = null, t = ""; for (let i = 0; i < n; i++) { t += q === last ? "=" : "#"; last = i % 3 ? q : null; if (i & 1) q = { v: i }; } return t + q.v; },
  returnsIt(start, n) { let q = make(start, false); for (let k = 0; !q.done; k++) q = make(k, k >= n); return JSON.stringify(q); },
  breaksWithIt(start, n) { let q = make(0, false); for (let k = 1; ; k++) { if (q.done) break; q = make([k], k > n); } return Array.isArray(q.value) + JSON.stringify(q); },
  nested(start, n) { let s = 0; for (let r = 0; r < 3; r++) { let k = 0; for (let q = make(r, false); !q.done; q = make(k, k >= n)) { s += q.value; k++; } } return s; },
  nestedCarried(start, n) { let outer = { v: 0, w: 1 }; for (let r = 0; r < 4; r++) { let inner = { v: outer.v, w: outer.w }; for (let i = 0; i < n; i++) inner = { v: inner.w, w: (inner.v + inner.w) % 1000 }; outer = { v: inner.v, w: inner.w + r }; } return outer.v + ":" + outer.w; },
  throwsWithIt(start, n) { let q = { v: 0 }; try { for (;;) { if (q.v >= n) throw q; q = { v: q.v + 1 }; } } catch (e: any) { return "thrown " + JSON.stringify(e) + (e === q); } },
  caught(start, n) { let q = { v: 0 }, t = 0; for (let i = 0; i < n; i++) { try { if (q.v === 2) throw new Error("x"); t += q.v; q = { v: q.v + 1 }; } catch { t += 100; q = { v: 5 }; } } return t + q.v; },
  finallyReads(start, n) { let q = { v: 0 }, t = ""; for (let i = 0; i < n; i++) { try { q = { v: q.v + i }; if (i === 2) continue; } finally { t += q.v + ","; } } return t; },
  closes(start, n) { const made: (() => any)[] = []; let q = { v: 0 }; for (let i = 0; i < n; i++) { const held = q; made.push(() => held.v); q = { v: q.v + 2 }; } return made.map(f => f()).join(); },
  closesOver(start, n) { let q = { v: 0 }; const read = () => q.v; let t = ""; for (let i = 0; i < n; i++) { t += read(); q = { v: q.v + 1 }; } return t; },
  calls(start, n) { const see = (o: any) => { log.push(String(o.v)); o.v = -1; }; let q: any = { v: 0 }; for (let i = 0; i < n; i++) { if (i % 3 === 1) see(q); q = { v: q.v + 1 }; } return log.splice(0).join() + q.v; },
  spreads(start, n) { let st: any = { n: 0, m: "m" }; for (let i = 0; i < n; i++) st = { ...st, n: st.n + i, ["k" + (i & 1)]: i }; return JSON.stringify(st); },
  accessor(start, n) { let reads = 0; let q: any = { get v() { return ++reads; } }; let t = 0; for (let i = 0; i < n; i++) { t += q.v; if (i & 1) q = { get v() { return reads += 10; } }; } return t + ":" + reads; },
  deletes(start, n) { let q: any = { v: 1, w: 2 }; let t = ""; for (let i = 0; i < n; i++) { if (i % 3 === 2) delete q.v; t += String(q.v) + ("v" in q ? "+" : "-"); if (i & 1) q = { v: i, w: 0 }; } return t; },
  freezes(start, n) { let q: any = { v: 1 }; let t = ""; for (let i = 0; i < n; i++) { if (i === 1) Object.freeze(q); try { q.v = i + 5; } catch (e: any) { t += e.name; } t += q.v; if (i & 1) q = { v: i }; } return t; },
  prototype(start, n) { let q: any = { v: 1 }; let t = ""; for (let i = 0; i < n; i++) { if (i === 2) Object.setPrototypeOf(q, { w: 9 }); t += q.v + ":" + q.w + " "; if (i !== 2) q = { v: i }; } return t; },
  nullish(start, n) { let q: { v: number } | null = { v: 3 }; let t = ""; while (q) { t += q.v; q = q.v > 0 ? { v: q.v - 1 } : null; } return t; },
  linked(start, n) { let s = 0; for (let i = 0; i < n; i++) for (let q: any = { v: i, next: { v: 2, next: { v: 3, next: null } } }; q; q = q.next) s += q.v; return s; },
  pairs(start, n) { let p: [number, number] = [0, 1]; for (let i = 0; i < n; i++) p = [p[1], (p[0] + p[1]) & 1023]; return p.join(); },
  strings(start, n) { let q = { t: "", n: 0 }; while (q.n < n) q = { t: q.t + q.n, n: q.n + 1 }; return q.t; },
  bigints(start, n) { let q = { v: 1n }; for (let i = 0; i < n; i++) q = { v: q.v * 3n }; return q.v; },
  deep(start, n) { let q = { a: { b: 1 }, c: 2 }; for (let i = 0; i < n; i++) q = { a: { b: q.c + i }, c: q.a.b }; return q.a.b + ":" + q.c; },
  iterator(start, n) { let k = 0; const it = { next() { return k < n ? { value: k++, done: false } : { value: undefined, done: true }; } }; let s = 0; for (let r: any = it.next(); !r.done; r = it.next()) s += r.value; return s + ":" + k; },
  generator(start, n) { const g = (function* () { for (let i = 0; i < n; i++) yield i * 2; return "end"; })(); let t = ""; let r: any = g.next(); for (; !r.done; r = g.next()) t += r.value; return t + r.value; },
  reduces(start, n) { const r = Array.from({ length: n }, (_, i) => i).reduce((a, v) => ({ sum: a.sum + v, n: a.n + 1 }), { sum: 0, n: 0 }); return r.sum + "/" + r.n; },
  someTurns(start, n) { let best = { v: -1, at: -1 }; for (let i = 0; i < n; i++) { const v = (i * 37) % 11; if (v > best.v) best = { v, at: i }; } return best.v + "@" + best.at; },
  labeled(start, n) { let q = { v: 0 }, t = 0; outer: for (let i = 0; i < n; i++) { for (let j = 0; j < 3; j++) { t += q.v; if (j === 1 && i & 1) { q = { v: i }; continue outer; } } q = { v: q.v + 1 }; } return t; },
  argument(start, n) { let q: any = { v: start }; for (let i = 0; i < n; i++) q = { v: [q.v, i].length + i }; return q.v; },
};
const show = (value: any): string => typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : String(value).slice(0, 120);
for (const name of Object.keys(loops)) {
  const line: string[] = [];
  for (const n of [0, 1, 2, 5, 12]) {
    for (const start of name === "iterates" || name === "counts" || name === "returnsIt" || name === "argument" ? starts : [0]) {
      if (name === "counts" && (typeof start !== "number" || !(start < 1e6))) continue;
      try { line.push(show(loops[name](start, n))); } catch (e) { line.push((e as Error).name); }
    }
  }
  console.log(name, line.join(" | "));
}
async function awaits(n: number) { let q = { v: 0, w: 1 }; for (let i = 0; i < n; i++) { q = { v: q.w, w: q.v + q.w }; await null; } return q.v; }
function* yields(n: number): Generator<any, any, any> { let q = { v: 0 }; for (let i = 0; i < n; i++) { const sent: any = yield q.v; q = { v: q.v + (sent ?? 1) }; } return q.v; }
const g = yields(4); let said: any = g.next(), t = ""; while (!said.done) { t += said.value + ","; said = g.next(said.value + 2); }
console.log("yields", t + said.value);
awaits(9).then(v => console.log("awaits", v));
