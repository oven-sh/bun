// What a call passes beyond the named parameters lies in the array of the rest parameter, and whoever keeps that array or an element of it keeps the value.
const out = [];
function churn() { const junk = []; for (let i = 0; i < 200000; i++) junk.push({ a: i, b: [i] }); return junk.length; }

let kept1; function take1(...rest) { kept1 = rest[0]; }
function make1(i) { const o = { x: i, y: [i, i + 1] }; take1(o); }
for (let i = 0; i < 5; i++) make1(i);
churn(); out.push("element: " + kept1.x + " " + kept1.y.join());

let kept2; function take2(a, ...rest) { kept2 = rest; }
function make2(i) { const o = { x: i }; const p = { z: "p" + i }; take2(0, o, p); }
for (let i = 0; i < 5; i++) make2(i);
churn(); out.push("array: " + kept2.length + " " + kept2[0].x + " " + kept2[1].z);

let kept3; function take3(...rest) { kept3 = rest[1]; }
function make3(i) { let n = i; take3(0, () => n++); }
for (let i = 0; i < 5; i++) make3(i * 10);
churn(); out.push("closure: " + kept3() + " " + kept3());

let kept4; function take4(...rest) { kept4 = rest[0]; }
function make4(i) { const a = [i, i * 2, i * 3]; take4(a); a.push(7); }
for (let i = 0; i < 5; i++) make4(i);
churn(); out.push("an array: " + kept4.join());

let kept5; class Taker { take(...rest) { kept5 = rest[0]; } }
function make5(t, i) { const o = { x: i }; t.take(o); o.x += 100; }
const taker = new Taker(); for (let i = 0; i < 5; i++) make5(taker, i);
churn(); out.push("method: " + kept5.x);

let kept6; function take6(...rest) { kept6 = rest[0]; } function read6() { return "w" in kept6 ? kept6.w : "missing"; }
function Made6() { take6(this); this.early = read6(); this.w = 5; }
out.push("constructor function: " + new Made6().early + " " + read6());

let kept7; function take7(a, ...rest) { kept7 = rest[0]; } function read7() { const t = kept7.x; return t === undefined ? "missing" : t + 1; }
class C7 { constructor() { take7(1, this); this.early = read7(); this.x = 1; } }
out.push("behind a named parameter: " + new C7().early + " " + read7());

let kept8; function read8() { const t = kept8.x; return t === undefined ? "missing" : t + 1; }
class C8 { constructor() { [0].forEach(function (...rest) { kept8 = this; }, this); this.early = read8(); this.x = 1; } }
out.push("this of a callback with a rest parameter: " + new C8().early + " " + read8());

let kept9; function read9() { const t = kept9.x; return t === undefined ? "missing" : t + 1; }
class C9 { constructor() { [this].forEach((...rest) => { kept9 = rest[0]; }); this.early = read9(); this.x = 1; } }
out.push("an element handed to a callback with a rest parameter: " + new C9().early + " " + read9());

console.log(out.join("\n"));
