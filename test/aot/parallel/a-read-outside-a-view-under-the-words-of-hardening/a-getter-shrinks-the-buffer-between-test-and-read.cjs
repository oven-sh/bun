"use strict";
// Under: --aot-testing=CheckBoundsInEmittersOnly: a read outside a view gives nothing, which is lawful: a hold on a wide integer once met the mark of nothing ahead of the question for it and stopped this right program.
const view = new Uint8Array(new ArrayBuffer(12, { maxByteLength: 16 })).fill(3); const box = { n: 0, get step() { if (++this.n === 2) view.buffer.resize(2); return 1; } };
function f(v, b) { let s = ""; for (let i = 0; i + 2 < v.length; i += 3) { const k = b.step; s += v[i] * k + "," + v[i + 2] * k + ";"; } return s; }
console.log(f(view, box));
