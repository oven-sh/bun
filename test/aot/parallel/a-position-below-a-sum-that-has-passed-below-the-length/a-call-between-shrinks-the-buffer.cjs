"use strict";
const buffer = new ArrayBuffer(12, { maxByteLength: 16 }); const view = new Uint8Array(buffer).fill(7);
let calls = 0; function meddle() { if (++calls === 2) buffer.resize(4); }
function f(v) { let s = ""; for (let i = 0; i + 2 < v.length; i += 3) { meddle(); s += v[i] + "," + v[i + 1] + "," + v[i + 2] + ";"; } return s; }
console.log(f(view), view.length);
