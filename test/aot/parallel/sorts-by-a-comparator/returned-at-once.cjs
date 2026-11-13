// A sort is returned at once by functions, methods, generators and async functions, and its comparator throws or stores.
const z = JSON.parse("[0]")[0], out = [], say = (f) => { try { return String(f()); } catch (e) { return e.name + ":" + e.message; } };
const mk = (n, g) => { const l = []; for (let i = 0; i < n; i++) l.push(g(i)); return l; }, show = (l) => l.length + "[" + Array.from({ length: Math.min(l.length, 40) }, (_, i) => (i in l ? (Object.is(l[i], -0) ? "-0" : typeof l[i] === "object" && l[i] ? l[i].k + "#" + l[i].id : String(l[i])) : "_")).join() + "]";
const table = { up: (a, b) => a - b, down: (a, b) => b - a, k: (a, b) => a.k - b.k, none: () => 0 }, name = (s) => JSON.parse('["' + s + '"]')[0];
const sizes = [2, 7, 11, 12, 13, 24, 63, 64, 65, 130];
function ret(l, f) { return l.sort(f); } function inTry(l, f) { try { return l.sort(f); } catch (e) { return [e.message]; } finally { out.push("f"); } } const arrow = (l, f) => l.sort(f); class S { go(l, f) { return l.sort(f); } static of(l, f) { return new S().go(l, f); } } const o = { v: 1 };
function around(l, f) { const before = o.v; const r = ret(l, f); return before * 1000 + o.v * 10 + r.length; }
for (const n of [3, 12, 40]) for (const g of [ret, inTry, arrow, S.of]) { out.push(show(g(mk(n, (i) => i * 7 % n), table[name("up")]))); let c = 0; out.push(say(() => show(g(mk(n, (i) => i * 7 % n), () => { if (++c === 3) throw new Error("third"); return 1; })))); out.push(say(() => show(g({ length: 2, sort: () => [9, 8] }, 1)))); out.push(say(() => show(g(mk(n, (i) => i), 5)))); out.push(say(() => show(g(mk(n, (i) => -i), undefined)))); out.push(say(() => show(g(mk(n, (i) => i), null)))); }
for (const n of [3, 20]) { let c = 0; out.push(around(mk(n, (i) => -i), (a, b) => { o.v = ++c; return a - b; })); o.v = 1; }
async function later(l, f) { return l.sort(f); } function* gen(l, f) { return yield l.sort(f); } const g = gen(mk(14, (i) => -i), table.up); out.push(show(g.next().value));
later(mk(14, (i) => -i), table[name("up")]).then((l) => { console.log(show(l)); return later(mk(14, (i) => i), () => { throw new Error("async"); }); }).catch((e) => console.log(e.message));
console.log(out.join("\n"));
