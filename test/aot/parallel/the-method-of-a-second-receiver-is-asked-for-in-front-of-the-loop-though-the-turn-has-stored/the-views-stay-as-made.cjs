"use strict";
const make = () => { const v = new DataView(new ArrayBuffer(256)); for (let i = 0; i < 256; i++) v.setUint8(i, i * 7); return v; };
const first = new DataView(new ArrayBuffer(256)), second = new DataView(new ArrayBuffer(256)), source = make(), other = make();
function f(t) { for (let i = 0; i < 64; i++) { first.setUint8(i, source.getUint8(i)); second.setUint8(i, other.getUint8(i) + t); } return first.getUint8(t & 63) + second.getUint8(3); }
const n = +process.argv[2] || 12, at = +process.argv[3] || 5; let sum = 0;
for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
