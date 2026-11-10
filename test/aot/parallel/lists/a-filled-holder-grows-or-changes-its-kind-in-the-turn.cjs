// STATISTIC: HoldersAskedForBytesPastNamesOfListsAndViews >= 1
"use strict";
const show = v => Array.isArray(v) || ArrayBuffer.isView(v) ? "[" + Array.from(v, show).join() + "]" : Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
function f0(a, b) { a.fill(0.5); let s = 0; for (let i = 0; i < a.length; i++) { a[i] = a[i] * 3; s += a[i]; } return s; }
function f1(a, b) { a.fill(1); let s = 0; for (let i = 0; i < a.length && i < 12; i++) { s += a[i] * 2; if (i < 5) a[a.length] = i * 0.5; } return s; }
function f2(a, b) { a.fill(1); let s = 0; for (let i = 0; i < a.length && i < 12; i++) { s += a[i] * 2; if (i < 5) b[b.length] = "g"; a[i] = i * 1; } return s; }
function f3(a, b) { a.fill(2); let s = 0; for (let i = 0; i < a.length; i++) { if (i === 2) b.length = 2; s += a[i] * 1; a[i] = s * 1; } return s; }
function f4(a, b) { a.fill(1); let s = 0; for (let i = 0; i < a.length; i++) { if (i === 1 && a.buffer && a.buffer.resizable) a.buffer.resize(8); s += a[i] * 1; a[i] = i * 3; } return [s, a.length]; }
const make = [() => JSON.parse("[3,9,4,1,0,7]"), () => JSON.parse("[0.5,-0,2.5,1e300,3,1]"), () => Uint8Array.of(1, 2, 3, 4, 5, 6), () => Int16Array.of(-1, 2, 300, 4), () => Float64Array.of(0.5, -0, NaN, 2), () => Float32Array.of(0.1, 3, 5), () => Buffer.from([1, 2, 3, 4]), () => [1, , 3, "4", null], () => new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })), () => new BigInt64Array(3), () => Object.freeze([1, 2, 3]), () => [], () => "1234", () => ({ length: 3, 0: 1, fill() { this[1] = 9; } }), () => new (class extends Uint8Array { fill() { return this; } })(4), () => new (class extends Array { fill() { this[0] = 8; return this; } })(4), () => null];
const ops = { go(a, b, k) { return [f0, f1, f2, f3, f4][k](a, b); } }, ways = JSON.parse("[0,1,2,3,4]"), out = [];
for (let r = 0; r < 4; r++) for (const k of ways) for (const at of make.keys()) for (const two of [0, 1]) { const a = make[at](), b = two ? a : make[(at + 1) % make.length](); try { out.push(show(ops.go(a, b, k)) + show(a)); } catch (e) { out.push(e.name); } }
let h = 7; for (const w of out) for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 1000003; console.log(out.length, h, out.slice(-8).join("|"));
