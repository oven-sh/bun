// Accessors that nested loops define between calls that come in arms: a getter alone, a setter alone, both, several, by literal, by definitions, by classes, two and three loops deep, with break and continue.
const lines = [];
let H, n0 = 0;
const tell = (o) => Reflect.ownKeys(o).map((k) => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + typeof d.value : "<" + !!d.get + "|" + !!d.set + ">") + (d.enumerable ? "" : "h"); }).join(" ");
const put = (f) => { try { lines.push(String(f())); } catch (e) { lines.push(e.constructor.name); } };
const show = () => { put(() => tell(H)); put(() => H.n); put(() => { H.n = 1; return H.c; }); };
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get n() { if (++this.c > 2) this.t = U; }, set n(v) {} } }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get n() { if (++this.c > 2) this.t = U; return T.length; } } }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, set n(v) { this.c = typeof U + typeof T; } } }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, set n(v) { this.c = v; }, get n() { return typeof U; }, get m() { return T; }, set m(v) { n0++; } } }
show(); put(() => H.m);
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c']) for (const C of [() => 1, () => 2.5, () => null]) for (let w = 0; w < 3; w++) { const T = A(), U = B(), V = C(); if (w === 2 && V === null) break; if (w === 1 && U === 'a') continue; H = { c: w, get n() { this.t = V; return U; }, set n(v) { this.c = T.length; }, get m() { return V; } }; n0 += H.c; }
show(); put(() => H.m);
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0 }; Object.defineProperty(H, "n", { get() { if (++this.c > 2) this.t = U; return U; }, set(v) { this.c = T.length; }, enumerable: true, configurable: true }); }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0 }; Object.defineProperties(H, { n: { get() { return U; }, set(v) { this.c = T.length; } }, m: { get: () => T } }); }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0 }; H.__defineGetter__("n", function () { return U; }); H.__defineSetter__("n", function (v) { this.c = T.length; }); }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = new (class { c = 0; get n() { return typeof U; } set n(v) { this.c = T.length; } })(); }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = class { static c = 0; static get n() { return typeof U; } static set n(v) { this.c = T.length; } }; }
put(() => H.n); put(() => { H.n = 1; return H.c; });
function run(limit) {
  let last;
  for (const A of [() => 'wxyz', () => Buffer.from, () => [1]]) for (const B of [() => [], () => 'a', () => limit]) for (let w = 0; w < limit; w++) {
    const T = A(), U = B();
    const o = { c: w, get n() { if (++this.c > 2) this.t = U; return this.c; }, set n(v) { this.c = v; }, get ["k" + 1]() { return T; }, set ["k" + 1](v) { n0 += v; } };
    if (typeof U === "string" && w) continue;
    o.n = 5; o.k1 = 1; last = { ...o }; H = o;
  }
  return tell(last);
}
for (let limit = 1; limit < 5; limit++) { put(() => run(limit)); show(); }
console.log(lines.join("\n")); console.log(n0);
