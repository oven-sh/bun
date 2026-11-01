// Many values made late: the generator is suspended at its first yield while most words of its frame have never been stored.
function* late(n) {
  yield "start";
  const a = { a: n }, b = [n, n + 1], c = "s" + n, d = n * 1.5, e = new Map([[n, n]]), f = () => n, g = Symbol("g" + n), h = BigInt(n);
  yield a;
  const i = { i: a }, j = [b, c], k = c + d, l = d + 0.25, m = new Set([e]), o = () => f() + 1, p = /x/g, q = new Date(n);
  yield [i, j];
  const r = { r: i }, s = [j, k], t = k + l, u = l * 2, v = new WeakMap([[a, m]]), w = () => o() + 1, x = [p, q], y = { g, h };
  yield [r, s];
  yield [a, b, c, d, e.size, f(), g.description, String(h), i, j, k, l, m.size, o(), p.source, q.getTime(), r, s, t, u, v.has(a), w(), x.length, y.h === h];
}
const kept = [];
for (let n = 0; n < 300; n++) { const it = late(n); it.next(); kept.push(it); }
Bun.gc(true);
const junk = []; for (let i = 0; i < 20000; i++) junk.push({ i }, [i], "j" + i);
Bun.gc(true);
let sum = 0;
for (const it of kept) { it.next(); Bun.gc(false); }
for (const it of kept) { it.next(); it.next(); }
Bun.gc(true);
for (const it of kept) sum += JSON.stringify(it.next().value).length;
console.log(sum, junk.length, JSON.stringify(late(process.argv.length).next()));
const one = late(process.argv.length + 5); one.next(); one.next(); one.next(); one.next(); console.log(one.next().value);
