// STATISTIC: HoldersAskedForBytesPastNamesOfListsAndViews >= 1
"use strict";
const hide = v => [v][JSON.parse("0")], out = [], show = v => Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(Array.from(v.length >= 0 ? v : [], e => (typeof e === "bigint" ? e + "n" : e))) : String(v);
function sieve(s, n) { s.fill(1); let c = 0; for (let i = 2; i * i < s.length; i++) if (s[i]) for (let j = i * i; j < s.length; j += i) s[j] = 0; for (let i = 2; i < s.length; i++) c += s[i] * 1; return c; }
function scaled(a) { const b = a.slice(); for (let i = 0; i < a.length; i++) b[i] = a[i] * 2; return b.indexOf(4) + b.length; }
function pushed(a) { let s = 0; for (let i = 0; i < 6; i++) { s += a[i] * 3; if (i === 2) a.push(7); } return s + a.join(); }
function sorted(a) { let s = 0; for (let i = 0; i < a.length; i++) { if (i === 3) a.reverse(); s = (s + a[i] * (i + 1)) | 0; } return s; }
function concat(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * 1; return s + String(a.concat(1)).length; }
const makes = [() => [1, 2, 3, 4, 5, 6], () => [0.5, 1.5, 2, 3], () => Uint8Array.of(1, 2, 3, 4, 5), () => Float32Array.of(0.1, 2, 3), () => Buffer.from([1, 2, 3, 4]), () => [1, , 3, "4", null], () => "12345", () => ({ length: 3, 0: 1, 1: 2, fill() { this[2] = 9; }, slice() { return [5, 6, 7]; }, push() {}, join() { return "j"; }, reverse() {}, indexOf() { return -2; }, concat() { return "c"; } }), () => new (class extends Array { fill() { return this; } })(5), () => null, () => Object.freeze([1, 2, 3, 4]), () => new BigInt64Array(4), () => { const a = [1, 2, 3, 4]; a.fill = () => a; return a; }, () => new Proxy([1, 2, 3, 4], {}), () => new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 }))];
for (let r = 0; r < 6; r++) for (const f of [sieve, scaled, pushed, sorted, concat]) for (let k = 0; k < (r < 2 ? 3 : makes.length); k++) { const a = makes[k](); try { out.push(show(hide(f)(a, 5))); } catch (e) { out.push(e.name); } out.push(show(a)); }
let h = 7; for (const w of out) for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 1000003; console.log(out.length, h, out.slice(0, 16).join("|"));
