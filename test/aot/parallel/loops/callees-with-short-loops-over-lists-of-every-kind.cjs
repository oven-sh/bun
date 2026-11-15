"use strict";
function dot2(a, b) { let s = 0; for (let i = 0; i < 2; i++) s += a[i] * b[i]; return s; }
function dot3(a, b) { let s = 0; for (let i = 0; i < 3; i++) s += a[i] * b[i]; return s; }
function back4(a, b) { let s = 0; for (let i = 3; i >= 0; i--) s += a[i] * b[i]; return s; }
function sum8(a) { let s = 0; for (let i = 0; i < 8; i++) s += a[i]; return s; }
function add3(o, a, b) { for (let i = 0; i < 3; i++) o[i] = a[i] + b[i]; return o; }
function until(a, x) { let s = 0; for (let i = 0; i < 4; i++) { if (a[i] === x) break; s += i; } return s; }
function joined(a) { let s = ""; for (let i = 0; i < 3; i++) s += a[i]; return s; }
let touched = 0;
const makers = [
    () => [0.5, 1.5, 2.5, 3.5, 1, 1, 1, 1], () => [1, 2, 3, 4, 5, 6, 7, 8], () => [1, , 3, 4], () => [1.5, , 2.5], () => [1, 2], () => [], () => ["a", "b", "c", "d"], () => [NaN, -0, Infinity, 1],
    () => [1n, 2n, 3n, 4n], () => [{ valueOf() { touched++; return 2; } }, 1, 2, 3], () => new Float64Array([0.5, 1.5, 2.5, 3.5]), () => new Uint8Array([1, 2, 3]), () => ({ length: 4, 0: 1, 1: 2, 2: 3, 3: 4 }),
    () => new Proxy([1, 2, 3, 4], { get(t, k, r) { touched++; return Reflect.get(t, k, r); } }), () => { const l = [1, 2, 3, 4]; Object.defineProperty(l, 1, { get() { touched++; l[2] = "x"; return 5; }, configurable: true }); return l; },
    () => Object.freeze([1.5, 2.5, 3.5, 4.5]), () => "text", () => null, () => 7,
];
let digest = 7, lines = 0;
const say = f => { let r; try { r = f(); } catch (e) { r = e.name; } const said = (typeof r === "object" && r ? "[" + Array.from(r).join() + "]" : typeof r + String(r)).slice(0, 80); lines++; for (let c = 0; c < said.length; c++) digest = (digest * 31 + said.charCodeAt(c)) % 1000003; return said; };
const runs = [
    (a, b) => { let s = 0; for (let t = 0; t < 12; t++) s += dot2(a, b); return s; },
    (a, b) => { let s = 0; for (let t = 0; t < 8; t++) s += dot3(a, b); return s; },
    (a, b) => { let s = 0; for (let t = 0; t < 9; t++) { s += back4(a, b); if (t === 4 && Array.isArray(a) && !Object.isFrozen(a)) a[1] = "changed"; } return s; },
    (a, b) => { let s = 0; for (let t = 0; t < 9; t++) { s += dot3(a, b); if (t === 3 && Array.isArray(b) && !Object.isFrozen(b)) b.length = 1; } return s; },
    (a, b) => { let s = 0; for (let t = 0; t < 6; t++) s += sum8(t & 1 ? a : b); return s; },
    (a, b) => { let o = [0, 0, 0]; for (let t = 0; t < 5; t++) o = add3(o, a, b); return o; },
    (a, b) => { let o = [0.5, 0.5, 0.5]; for (let t = 0; t < 5; t++) add3(o, o, a); return o; },
    (a, b) => { let s = 0; for (let t = 0; t < 7; t++) s += until(a, b === null || b === undefined ? b : b[t & 3]); return s; },
    (a, b) => { let s = ""; for (let t = 0; t < 3; t++) s += joined(t ? a : b); return s; },
];
const shown = [];
for (let round = 0; round < 3; round++) for (let i = 0; i < makers.length; i++) for (let j = 0; j < makers.length; j++) for (let k = 0; k < runs.length; k++) { const said = say(() => runs[k](makers[i](), makers[j]())); if (round === 2 && (i * 7 + j * 3 + k) % 97 === 0) shown.push(i + "." + j + "." + k + " " + said); }
console.log(lines, digest, touched); console.log(shown.join("\n"));
