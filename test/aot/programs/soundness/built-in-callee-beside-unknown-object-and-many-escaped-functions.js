// A callee set that holds the unknown object and more than eight escaped functions stops listing escaped functions. One of them is Map.prototype.set.
function a0() {} function a1() {} function a2() {} function a3() {} function a4() {} function a5() {} function a6() {} function a7() {} function a8() {} function a9() {}
const fns = [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, Map.prototype.set];
console.log(fns.length, typeof fns[10]);
function same(x) { return x; }
const name = String(Date.now() > 0 ? "noSuchGlobal" : "other");
const unknown = globalThis[name];
let f = unknown;
for (let i = 0; i < fns.length; i++) f = same(same(fns[i]));
const m = new Map();
f.call(m, "k", { x: 1 });
const got = m.get("k");
console.log(m.size, got === undefined ? "undefined" : got.x);
