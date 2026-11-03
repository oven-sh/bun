// A value that a call or an operation delivers as several results lives across a yield.
function two(n) { return { a: n + 1, b: "s" + n }; }
function three(n) { return { a: { cell: n }, b: n * 0.5, c: n % 2 ? undefined : "c" }; }
function pair(n) { return [n, { n }]; }
function maybe(n) { return n % 3 ? { v: [n] } : undefined; }
function* g2(n) { const p = two(n); yield 1; yield p.a; yield p.b; }
function* g3(n) { const p = three(n); yield 1; yield p.a.cell; Bun.gc(true); yield p.b; yield p.c; yield p; }
function* gp(n) { const [x, y] = pair(n); yield x; yield y.n; }
function* gm(n) { const m = maybe(n); yield 0; yield m ? m.v[0] : "none"; yield m?.v.length; }
function* lateRead(n) { const p = three(n); for (let i = 0; i < 2; i++) yield i; if (n > 1) yield p.c; yield p.b; yield p.a; }
function* map(n) { const m = new Map([[1, { n }], [2, "two"], [3, 3.5]]); const it = m.entries(); const f = it.next(); yield "first"; yield f.value[0]; yield f.value[1]; yield f.done; for (const [k, v] of it) { yield k; yield v; } }
function* set(n) { const s = new Set([{ n }, "x", 1.5]); for (const v of s) { yield "in"; yield v; } }
function* forIn(n) { const o = { a: n, b: 2, c: 3 }; for (const k in o) { yield k; yield o[k]; } }
function* list(n) { const a = [{ n }, "y", 2.5]; for (const [i, v] of a.entries()) { yield i; yield v; } }
function* match(n) { const m = /(\d)(x)?/.exec("a" + (n % 10)); yield "m"; yield m[1]; yield m[2]; yield m.index; }
function* divmod(n) { const q = Math.trunc(n / 3), r = n % 3; yield q; yield r; yield q * 3 + r; }
function* inner(n) { const sent = yield n; const again = yield sent; yield [sent, again]; }
function* outer(n) { const r = yield* inner(n); yield r; }
for (const f of [g2, g3, gp, gm, lateRead, map, set, forIn, list, match, divmod, outer])
  for (const n of [0, 1, 2, 3, process.argv.length + 5]) console.log(f.name, n, JSON.stringify([...f(n)]));
const i = inner(1); console.log(i.next(), i.next("a"), i.next({ b: 1 }), i.next());
