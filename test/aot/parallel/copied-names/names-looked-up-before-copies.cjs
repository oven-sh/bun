// STATISTIC: StoresResolvedToLiteralKeys <= 700
// A loop gives the names that are stored in a record, however they got there. A name that was only looked up in records of the shape is none of them.
const out = [];
class A { constructor(o) { Object.assign(this, o); } get() { return this.a + this.p; } }
class B { constructor(o) { Object.assign(this, o); } get() { return this.a + this.q; } }
class C { constructor(o) { Object.assign(this, o); } get() { return this.a + this.r; } }
class D { constructor(o) { Object.assign(this, o); } get() { return this.a + this.s; } }
function copyA(o) { const r = {}; for (const k in o) r[k] = o[k]; return r; }
function copyB(o) { const r = {}; for (const k in o) r[k] = o[k]; return r; }
function copyC(o) { const r = {}; for (const k of Object.keys(o)) r[k] = o[k]; return r; }
function copyD(o) { const r = {}; for (const k in o) if (Object.hasOwn(o, k)) r[k] = o[k]; return r; }
function copyE(o) { const r = {}; for (const k in o) r[k] = o[k]; return r; }
function copyF(o) { const r = {}; for (const k in o) r[k] = o[k]; return r; }
for (let i = 0; i < 100; i++) {
    const a = new A({ a: i, b: 2, p: 4 }), b = new B({ a: i, b: 2, q: 5 }), c = new C({ a: i, b: 2, r: 6 }), d = new D({ a: i, b: 2, s: 7 });
    const ra = copyA(i & 1 ? { a: 3, b: i } : a), rb = copyB(i & 1 ? { a: 3, b: i } : b), rc = copyC(i & 1 ? { a: 3, b: i } : c), rd = copyD(i & 1 ? { a: 3, b: i } : d);
    const re = copyE(i & 1 ? { a: 3, b: i } : { a: 2, t: i });
    out.push(ra.p, rb.q, rc.r, rd.s, re.t, ra.a + rb.b, rc.b, rd.a, re.a);
    const late = { a: 1, b: i };
    out.push(late.u, late.v, late.q, late.w);
    if (i % 3) late.u = i;
    if (i % 5 === 1) late.v = "t";
    const rf = copyF(late);
    late.w = i;
    const rg = copyF(late);
    out.push(rf.u, rf.v, rf.q, rf.w, rg.u, rg.v, rg.q, rg.w, a.get() + b.get() + c.get() + d.get());
    if (i < 8) out.push(Object.keys(ra).join(), Object.keys(rb).join(), Object.keys(rc).join(), Object.keys(rd).join(), Object.keys(re).join(), Object.keys(rf).join(), Object.keys(rg).join());
}
console.log(out.length, out.reduce((h, s) => { s = String(s); for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0; return h; }, 5381));
console.log(out.slice(0, 60).join(" "));
