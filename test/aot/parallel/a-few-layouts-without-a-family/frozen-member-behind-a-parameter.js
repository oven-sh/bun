"use strict";
function rename(o, to, d) { if (d) return rename(o, to, d - 1); o.kind = to; return o.kind; }
const a = { kind: "a", p: "x", q: "y" }, b = Object.freeze({ kind: "b", s: 1 }), c = { kind: "c", t: { u: 1 } };
let out = []; for (let i = 0; i < 100; i++) { for (const o of [0, 1, 2]) { try { out.push(o === 0 ? rename(a, "n" + i, 1) : o === 1 ? rename(b, "n" + i, 1) : rename(c, "n" + i, 1)); } catch (error) { out.push(error instanceof TypeError); } } }
console.log(out.slice(0, 3).join(), out.slice(-3).join(), a.kind, b.kind, c.kind);
