"use strict";
// Under: --aot-testing=CheckBoundsInEmittersOnly: a read outside a view gives nothing, which is lawful: a hold on a wide integer once met the mark of nothing ahead of the question for it and stopped this right program.
const buffer = new ArrayBuffer(12, { maxByteLength: 16 }); const view = new Uint8Array(buffer).fill(7);
let calls = 0; const shrink = () => { if (++calls === 2) buffer.resize(4); return 0; };
function f(v) { let s = ""; for (let i = 0; i + 2 < v.length; i += 3) s += (v[i] + shrink() + v[i + 1]) + "," + v[i + 2] + ";"; return s; }
console.log(f(view), view.length);
const other = new Uint8Array(new ArrayBuffer(12, { maxByteLength: 16 })).fill(5); const key = { n: 0, valueOf() { if (++this.n === 2) other.buffer.resize(1); return 1; } };
function g(v, k) { let s = ""; for (let i = 0; i + 2 < v.length; i += 3) s += v[i] * k + "," + v[i + 1] + "," + v[i + 2] + ";"; return s; }
console.log(g(other, key), other.length);
