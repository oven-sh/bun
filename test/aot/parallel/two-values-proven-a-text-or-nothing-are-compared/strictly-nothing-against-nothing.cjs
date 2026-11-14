'use strict';
function pick(k) { return k === 0 ? undefined : k === 1 ? null : k === 2 ? 'oak' : 'elm'; }
function same(a, b) { return a === b; }
const n = +process.argv[2] || 3000; let out = ''; for (let t = 0; t < n; t++) { out = ''; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out += same(pick(i), pick(j)) ? '1' : '0'; } console.log(out);
