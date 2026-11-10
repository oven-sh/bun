"use strict";
// Under: --aot-testing=EmittersAloneTestEveryPosition: a read outside a view gives nothing, which is lawful: a hold on a wide integer once met the mark of nothing ahead of the question for it and stopped this right program.
const buffer = new ArrayBuffer(12, { maxByteLength: 16 }); const view = new Uint8Array(buffer).fill(7);
let calls = 0; function meddle() { if (++calls === 2) buffer.resize(4); return 0; }
function f(v) { let s = ""; for (let i = 0; i + 2 < v.length; i += 3) { const a = v[i]; const k = meddle(); s += a + "," + (v[i + 1] + k) + "," + v[i + 2] + ";"; } return s; }
console.log(f(view), view.length);
