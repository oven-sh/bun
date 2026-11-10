"use strict";
const make = () => { const v = new DataView(new ArrayBuffer(256)); for (let i = 0; i < 256; i++) v.setUint8(i, i * 7); return v; };
const first = new DataView(new ArrayBuffer(256)), second = new DataView(new ArrayBuffer(256)), source = make(), other = make();
function f(t) { for (let i = 0; i < 64; i++) { first.setUint8(i, source.getUint8(i)); second.setUint8(i, other.getUint8(i) + t); } return first.getUint8(t & 63) + second.getUint8(3); }
const n = +process.argv[2] || 12, at = +process.argv[3] || 5; let sum = 0;
for (let t = 0; t < n; t++) { if (t === at) structuredClone(second.buffer, { transfer: [second.buffer] }); try { sum = (sum + f(t)) % 1000003; } catch (e) { sum += 7; if (t === at) console.log(e.constructor.name, first.getUint8(0), first.getUint8(1)); } }
console.log(sum);
