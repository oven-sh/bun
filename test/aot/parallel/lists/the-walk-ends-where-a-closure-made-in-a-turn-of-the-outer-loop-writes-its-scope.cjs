'use strict';
const r = new Uint32Array(16); for (let i = 0; i < 16; i++) r[i] = i * 2654435761;
function step(h) { let total = 0; for (let y = 0; y < h; y++) { let s0 = 0, s1 = 0; const add = v => { const c0 = s0 & v; s0 ^= v; s1 ^= c0; }; const me = r[y]; add(me << 1); add(me >>> 1); add(r[(y + 1) % h]); let n = s0 | s1; while (n) { n &= n - 1; total++; } } return total; }
let s = 0; for (let t = 0; t < 50; t++) s += step(16); console.log(s);
