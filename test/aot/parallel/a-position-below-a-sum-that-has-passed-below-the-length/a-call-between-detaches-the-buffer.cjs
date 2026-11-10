"use strict";
const view = new Uint8Array(12).fill(7);
let calls = 0; function meddle() { if (++calls === 2) view.buffer.transfer(); }
function f(v) { let s = ""; for (let i = 0; i + 2 < v.length; i += 3) { meddle(); s += v[i] + "," + v[i + 1] + "," + v[i + 2] + ";"; } return s; }
console.log(f(view), view.length);
