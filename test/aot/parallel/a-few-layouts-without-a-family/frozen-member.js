"use strict";
function rename(o, to) { o.kind = to; return o.kind; }
const a = { kind: "a", p: "x", q: "y", r: "z" }, b = Object.freeze({ kind: "b", s: 1 });
let out = []; for (let i = 0; i < 100; i++) { try { out.push(rename(i & 1 ? a : b, "n" + i)); } catch (error) { out.push(error instanceof TypeError); } }
console.log(out[0], out[1], out[98], out[99], a.kind, b.kind);
