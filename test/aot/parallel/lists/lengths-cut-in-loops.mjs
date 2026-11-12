// list.length = n in loops: shorter, the same, longer; lists of ints, doubles, texts, holes, nothing; frozen, sealed, shared by two names, with a setter beneath, very long.
"use strict";
const show = l => "[" + Array.from({ length: Math.min(l.length, 30) }, (_, k) => k in l ? (Object.is(l[k], -0) ? "-0" : String(l[k])) : "hole").join() + "]" + l.length;
const kept = [];
function ints(n) { const l = []; let s = 0; for (let k = 0; k < n; k++) { l.push(k, k + 1, 2, 3); l.length = 2; s += l.length + l[1]; l.length = k & 1; s += l.length; } return s + show(l); }
function doubles(n) { const l = [0.5]; let s = 0; for (let k = 0; k < n; k++) { l.push(k / 2, 1.5, -0); l.length = 1 + (k % 3); s += l[l.length - 1]; } return s + show(l); }
function texts(n) { const l = ["a"]; for (let k = 0; k < n; k++) { l.push("t" + k, "u"); if (k % 4 === 3) l.length = 1; if (k % 7 === 6) l.length = 0; } return show(l); }
function longer(n) { const l = [1, 2]; for (let k = 0; k < n; k++) { l.length = 2 + (k % 5); if (k % 3 === 0) l[l.length] = k; l.length = 2; } return show(l); }
function any(l, n, m) { for (let k = 0; k < n; k++) { l.length = m; } return show(l); }
function refill(n) { const l = []; let s = ""; for (let k = 0; k < n; k++) { l.length = 0; for (let q = 0; q < k % 6; q++) l[q] = q & 1 ? "x" : q; s = (s + show(l)).slice(-60); } return s; }
function big(n) { const l = []; let s = 0; for (let k = 0; k < n; k++) { for (let q = 0; q < 1500; q++) l.push(q); l.length = 3; s += l.length + l[2]; l.length = 0; } return s; }
function unknown(o, n) { let s = 0; for (let k = 0; k < n; k++) { o.length = k % 3; s += o.length; } return s; }
function objects(n) { const l = []; for (let k = 0; k < n; k++) { l.push({ k }, [k], k); if (k % 5 === 4) { kept.push(l[0]); l.length = 1; } } return l.length + ":" + kept.map(o => o.k).join(); }
const makers = [() => [1, 2, 3], () => [0.5, 1.5], () => ["a", , "c"], () => [], () => new Array(5), () => Object.freeze([1, 2, 3]), () => Object.seal([1, 2, 3]), () => Object.preventExtensions([1, 2]), () => Object.defineProperty([1, 2, 3], "length", { writable: false }), () => Object.defineProperty([1, 2, 3], 1, { value: 5, configurable: false }), () => Object.setPrototypeOf([1, , 3], { 1: "up" }), () => { const l = []; l[100] = 1; return l; }, () => [1, "2", 2.5], () => new (class extends Array { })(4), () => ({ length: 2 }), () => new Proxy([1, 2, 3], {}), () => Array.from({ length: 2000 }, (_, k) => k)];
for (let round = 0; round < 3; round++) {
  console.log(ints(40), doubles(30), texts(25), longer(20), refill(40), big(3), objects(24));
  for (const make of makers) { const lines = []; for (const m of [0, 1, 2, 3, 5, 50, 2 ** 32 - 1, -1, 1.5, "2", NaN, undefined]) { const l = make(); let line; try { line = any(l, 3, m); } catch (error) { line = error.name; } lines.push(line); } let line; try { line = unknown(make(), 7); } catch (error) { line = error.name; } console.log(lines.join(" "), line); }
}
const a = [1, 2, 3, 4], b = a; for (let k = 0; k < 4; k++) { b.length = 4 - k; console.log(show(a)); a.push(k + 0.5); }
