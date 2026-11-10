// Views and their heirs are read and stored under keys of every kind around calls that detach, shrink, lay names and getters, with booleans and sums beside.
"use strict";
const out = [], hide = v => [v][JSON.parse("0")], t = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } };
class Pixels extends Uint8Array { get sum() { return this.reduce((a, b) => a + b, 0); } at2(i) { return this[i] * 2; } } class Floats extends Float64Array {}
const U = new Uint8Array(6), P = new Pixels(6), F = new Floats(6), I = new Int32Array(6); P.tag = "own"; Object.defineProperty(F, "lazy", { get() { return "g" + this.length; }, configurable: true });
const keys = JSON.parse('[0,1,2,5,6,-1,"0","5","6","-0","sum","at2","tag","lazy","length","constructor","toString","__proto__",1.5,null,true,"1e0","00",4294967296]').concat([undefined, NaN, -0, Symbol("q"), { toString: () => "2" }]);
const show = v => (typeof v === "function" ? "f" + v.name : typeof v === "object" && v ? "o" : typeof v + (Object.is(v, -0) ? "-0" : String(v)));
function marks(ks) { U.fill(0); for (const k of ks) { U[k] = true; P[k] = k === 2; I[k] = k > 1; } return [U, P, I].map(v => [...v].join("")).join(); }
function counts(ks) { I.fill(0); for (const k of ks) I[k] += 1; for (const k of ks) I[k]++; return [...I].join(); }
function reads(v, ks) { let s = ""; for (let i = 0; i < ks.length; i++) s += show(v[ks[i]]) + (v[ks[i]] ? "y" : "n"); return s; }
function around(ks, f) { const v = new Uint8Array(6).fill(9); let s = ""; for (let i = 0; i < ks.length; i++) { const k = ks[i]; s += show(v[k]); f(v, i); v[k] = i; s += show(v[k]) + ","; } return s + v.length; }
function shrunk(ks) { const b = new ArrayBuffer(6, { maxByteLength: 8 }), v = new Uint8Array(b); let s = ""; for (let i = 0; i < ks.length; i++) { if (i === 1) b.resize(3); if (i === 3) b.resize(8); v[ks[i]] = i + 1; s += show(v[ks[i]]) + v.length; } return s; }
for (let r = 0; r < 5; r++) { hide(marks)([0, 1, 2]); hide(counts)([0, 1, 1]); hide(reads)(U, [0, 1]); }
for (const k of keys) { if (typeof k !== "symbol") t(() => hide(marks)([1, k, 2])); t(() => hide(counts)([1, k, k])); for (const v of [U, P, F]) t(() => hide(reads)(v, [0, k, 1])); t(() => hide(around)([0, k, 1, k], (v, i) => { if (i === 1) structuredClone(v.buffer, { transfer: [v.buffer] }); })); t(() => hide(around)([k, 0], v => { v.extra = 1; })); t(() => hide(shrunk)([k, 5, k, 5, 0])); for (const v of [U, P, I]) for (const n of ["tag2", "00", "1e0", "true", "null"]) delete v[n]; }
Object.defineProperty(Uint8Array.prototype, "up", { get() { return "up" + this.length; }, configurable: true }); t(() => hide(reads)(U, ["up", 0, "up"])); delete Uint8Array.prototype.up;
const order = []; t(() => { const v = new Uint8Array(3), k = { toString() { order.push("k"); return "1"; } }, x = { valueOf() { order.push("v"); return 7; } }; for (let i = 0; i < 2; i++) v[[k, 0][i]] = x; return order.join("") + v.join(); });
console.log(out.join("|"));
