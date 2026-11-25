"use strict";
// A name that a list gave may be gone from the object when it is read under it: undefined is stored then.
const out = [];
function drop(o, k) { if (k === "c") delete o.c; }
const show = q => [q.a, q.b, q.c, typeof q.b, typeof q.c, q.b === undefined, q.c + 1, "c" in q, Object.keys(q).join("")].join(" ");
function lateCounted(x) { const o = { a: x }; o.b = 2; o.c = 3; return o; }
class Counted { constructor(o) { const names = Object.keys(o); delete o.b; for (let i = 0; i < names.length; i++) this[names[i]] = o[names[i]]; } }
for (let i = 0; i < 3; i++) { const q = new Counted(lateCounted(i)); out.push("Counted " + show(q)); }
function lateIterated(x) { const o = { a: x }; o.b = 2; o.c = 3; return o; }
class Iterated { constructor(o) { const names = Object.keys(o); delete o.c; for (const k of names) this[k] = o[k]; } }
for (let i = 0; i < 3; i++) { const q = new Iterated(lateIterated(i)); out.push("Iterated " + show(q)); }
function lateEach(x) { const o = { a: x }; o.b = 2; o.c = 3; return o; }
class Each { constructor(o) { Object.keys(o).forEach(k => { drop(o, k); this[k] = o[k]; }); } }
for (let i = 0; i < 3; i++) { const q = new Each(lateEach(i)); out.push("Each " + show(q)); }
function lateInside(x) { const o = { a: x }; o.b = 2; o.c = 3; return o; }
class Inside { constructor(o) { for (const k of Object.keys(o)) { this[k] = o[k]; if (k === "a") delete o.b; } } }
for (let i = 0; i < 3; i++) { const q = new Inside(lateInside(i)); out.push("Inside " + show(q)); }
function lateNamed(x) { const o = { a: x }; o.b = 2; o.c = 3; return o; }
class Named { constructor(o) { const names = Object.getOwnPropertyNames(o); delete o["b"]; for (const k of names) { const v = o[k]; this[k] = v; } } }
for (let i = 0; i < 3; i++) { const q = new Named(lateNamed(i)); out.push("Named " + show(q)); }
function lateSome(x) { const o = { a: x }; o.b = 2; o.c = 3; return o; }
class Some { constructor(o) { const names = Object.keys(o); if (o.a & 1) delete o.b; for (const k of names) this[k] = o[k]; } }
for (let i = 0; i < 3; i++) { const q = new Some(lateSome(i)); out.push("Some " + show(q)); }
function latePairs(x) { const o = { a: x }; o.b = 2; o.c = 3; return o; }
class Pairs { constructor(o) { for (const [k, v] of Object.entries(o)) { drop(o, k); this[k] = v; } } }
for (let i = 0; i < 3; i++) { const q = new Pairs(latePairs(i)); out.push("Pairs " + show(q)); }
function lateKept(x) { const o = { a: x }; o.b = 2; o.c = 3; return o; }
class Kept { constructor(o) { for (const k of Object.keys(o)) this[k] = o[k]; } }
for (let i = 0; i < 3; i++) { const q = new Kept(lateKept(i)); out.push("Kept " + show(q)); }
class Held { constructor(x) { this.a = x; this.b = 2; } }
function beside(x) { const o = new Held(x); o.c = 3; return o; }
class Beside { constructor(o) { const names = Object.keys(o); delete o.c; for (const k of names) this[k] = o[k]; } }
for (let i = 0; i < 3; i++) out.push("Beside " + show(new Beside(beside(i))));
console.log(out.join("\n"));
