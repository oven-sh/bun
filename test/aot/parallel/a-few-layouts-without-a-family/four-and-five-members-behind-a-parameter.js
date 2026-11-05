function read(o, d) { return d ? read(o, d - 1) : o.kind; }
const a = { kind: "a", p: "x", q: "y" }, b = { kind: "b", s: 1 }, c = { kind: "c", t: { u: 1 } }, d = { kind: "d", v: 1, w: 2, x: 3 }, e = { kind: "e", y: "z" };
function four(i) { return read(a, 1) + read(b, 1) + read(c, 1) + read(d, 1); }
function read5(o, n) { return n ? read5(o, n - 1) : o.kind; }
function five(i) { return read5(a, 1) + read5(b, 1) + read5(c, 1) + read5(d, 1) + read5(e, 1); }
let out = ""; for (let i = 0; i < 100; i++) out = four(i) + five(i); console.log(out);
