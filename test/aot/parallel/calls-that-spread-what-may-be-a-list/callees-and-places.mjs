const xs = JSON.parse("[3,9,4]"), turns = JSON.parse("2");
const sly = [{ valueOf() { sly.length = 1; return 1; } }, 5, 7];
const o = { k: 10, m(a, b) { return this.k + a + b; } };
function add(a, b) { return a * 10 + b; }
function pair(a, b) { return [b, a]; }
function thrower(a, b) { throw a + b; }
function most(list, n) { let m = 0; for (let i = 0; i < n; i++) m = Math.max(...list); return m; }
function viaThis(list, n) { let s = 0; for (let i = 0; i < n; i++) s += o.m(...list); return s; }
function nested(list, n) { let s = 0; for (let i = 0; i < n; i++) s += add(...pair(...list)); return s; }
function twoSpreads(list, n) { let s = 0; for (let i = 0; i < n; i++) s += add(...list, ...list); return s; }
function guarded(list, n) { let s = 0; for (let i = 0; i < n; i++) { try { s += thrower(...list); } catch (e) { s += e + list.length; } } return s; }
function* stepped(list, n) { for (let i = 0; i < n; i++) yield add(...list); }
console.log(`SAID ${most(sly, 1)} ${viaThis(xs, turns)} ${nested(xs, turns)} ${twoSpreads(xs, turns)} ${guarded(xs, turns)} ${[...stepped(xs, turns)].join()}`);
