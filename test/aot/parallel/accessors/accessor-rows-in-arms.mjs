// Rows of getters and setters between calls that come in arms: each half of each row is defined once, whatever arms end between them.
const lines = []; let H, n0 = 0;
const tell = (o) => Reflect.ownKeys(o).map((k) => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + typeof d.value : "<" + !!d.get + "|" + !!d.set + ">") + (d.enumerable ? "" : "h"); }).join(" ");
const put = (f) => { try { lines.push(String(f())); } catch (e) { lines.push(e.constructor.name); } };
const show = () => { put(() => tell(H)); put(() => [H.n, H.m, H.k].join()); put(() => { H.n = 4; return H.c + "," + H.n; }); put(() => { H.m = 2; return n0; }); put(() => { H.k = 3; return n0; }); };
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, set n(v) { this.c = v; }, get n() { return typeof U + this.c; }, get m() { return typeof T; }, set m(v) { n0 += v; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get n() { return typeof U + this.c; }, get m() { return typeof T; }, set m(v) { n0 += v; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get m() { return typeof T; }, set m(v) { n0 += v; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, set n(v) { this.c = v; }, get n() { return typeof U + this.c; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get n() { return typeof U + this.c; }, set n(v) { this.c = v; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get n() { return typeof U + this.c; }, get m() { return typeof T; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, set n(v) { this.c = v; }, get n() { return typeof U + this.c; }, get m() { return typeof T; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, set n(v) { this.c = v; }, get m() { return typeof T; }, set m(v) { n0 += v; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get n() { return typeof U + this.c; }, set m(v) { n0 += v; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get m() { return typeof T; }, get n() { return typeof U + this.c; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get m() { return typeof T; }, get n() { return typeof U + this.c; }, set n(v) { this.c = v; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get m() { return typeof T; }, set m(v) { n0 += v; }, get n() { return typeof U + this.c; }, set n(v) { this.c = v; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get n() { return typeof U + this.c; }, get m() { return typeof T; }, get k() { return w; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get k() { return w; }, get m() { return typeof T; }, get n() { return typeof U + this.c; }, set ["k"](v) { n0 += typeof U === "string" ? 1 : 2; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get n() { return typeof U + this.c; }, set n(v) { this.c = v; }, get m() { return typeof T; }, set m(v) { n0 += v; }, get k() { return w; }, set ["k"](v) { n0 += typeof U === "string" ? 1 : 2; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, set ["k"](v) { n0 += typeof U === "string" ? 1 : 2; }, set m(v) { n0 += v; }, set n(v) { this.c = v; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get m() { return typeof T; }, d: U, get n() { return typeof U + this.c; }, set n(v) { this.c = v; } }; }
show();
for (const A of [() => 'wxyz', () => Buffer.from]) for (const B of [() => [], () => 'a', () => 'c', () => 'd']) for (let w = 0; w < 4; w++) { const T = A(), U = B(); H = { c: 0, get n() { return typeof U + this.c; }, set n(v) { this.c = v; }, d: T, get m() { return typeof T; }, set m(v) { n0 += v; } }; }
show();
function run0(limit) { for (const B of [() => [], () => 'a', () => limit]) for (let w = 0; w < limit; w++) { const U = B(), T = B; const o = { c: w, set n(v) { this.c = v; }, get n() { return typeof U + this.c; }, get m() { return typeof T; }, set m(v) { n0 += v; } }; if (w > 2 && typeof U === 'number') break; H = o; n0 += Object.keys(o).length; } }
for (let limit = 1; limit < 6; limit++) { run0(limit); show(); }
function run1(limit) { for (const B of [() => [], () => 'a', () => limit]) for (let w = 0; w < limit; w++) { const U = B(), T = B; const o = { c: w, get n() { return typeof U + this.c; }, get m() { return typeof T; }, set m(v) { n0 += v; } }; if (w > 2 && typeof U === 'number') break; H = o; n0 += Object.keys(o).length; } }
for (let limit = 1; limit < 6; limit++) { run1(limit); show(); }
function run2(limit) { for (const B of [() => [], () => 'a', () => limit]) for (let w = 0; w < limit; w++) { const U = B(), T = B; const o = { c: w, get m() { return typeof T; }, set m(v) { n0 += v; } }; if (w > 2 && typeof U === 'number') break; H = o; n0 += Object.keys(o).length; } }
for (let limit = 1; limit < 6; limit++) { run2(limit); show(); }
function run3(limit) { for (const B of [() => [], () => 'a', () => limit]) for (let w = 0; w < limit; w++) { const U = B(), T = B; const o = { c: w, set n(v) { this.c = v; }, get n() { return typeof U + this.c; } }; if (w > 2 && typeof U === 'number') break; H = o; n0 += Object.keys(o).length; } }
for (let limit = 1; limit < 6; limit++) { run3(limit); show(); }
function run4(limit) { for (const B of [() => [], () => 'a', () => limit]) for (let w = 0; w < limit; w++) { const U = B(), T = B; const o = { c: w, get n() { return typeof U + this.c; }, set n(v) { this.c = v; } }; if (w > 2 && typeof U === 'number') break; H = o; n0 += Object.keys(o).length; } }
for (let limit = 1; limit < 6; limit++) { run4(limit); show(); }
function run5(limit) { for (const B of [() => [], () => 'a', () => limit]) for (let w = 0; w < limit; w++) { const U = B(), T = B; const o = { c: w, get n() { return typeof U + this.c; }, get m() { return typeof T; } }; if (w > 2 && typeof U === 'number') break; H = o; n0 += Object.keys(o).length; } }
for (let limit = 1; limit < 6; limit++) { run5(limit); show(); }
function run6(limit) { for (const B of [() => [], () => 'a', () => limit]) for (let w = 0; w < limit; w++) { const U = B(), T = B; const o = { c: w, get n() { return typeof U + this.c; }, get m() { return typeof T; }, get k() { return w; } }; if (w > 2 && typeof U === 'number') break; H = o; n0 += Object.keys(o).length; } }
for (let limit = 1; limit < 6; limit++) { run6(limit); show(); }
function run7(limit) { for (const B of [() => [], () => 'a', () => limit]) for (let w = 0; w < limit; w++) { const U = B(), T = B; const o = { c: w, get k() { return w; }, get m() { return typeof T; }, get n() { return typeof U + this.c; }, set ["k"](v) { n0 += typeof U === "string" ? 1 : 2; } }; if (w > 2 && typeof U === 'number') break; H = o; n0 += Object.keys(o).length; } }
for (let limit = 1; limit < 6; limit++) { run7(limit); show(); }
function run8(limit) { for (const B of [() => [], () => 'a', () => limit]) for (let w = 0; w < limit; w++) { const U = B(), T = B; const o = { c: w, get n() { return typeof U + this.c; }, set n(v) { this.c = v; }, get m() { return typeof T; }, set m(v) { n0 += v; }, get k() { return w; }, set ["k"](v) { n0 += typeof U === "string" ? 1 : 2; } }; if (w > 2 && typeof U === 'number') break; H = o; n0 += Object.keys(o).length; } }
for (let limit = 1; limit < 6; limit++) { run8(limit); show(); }
console.log(lines.join("\n")); console.log(n0);
