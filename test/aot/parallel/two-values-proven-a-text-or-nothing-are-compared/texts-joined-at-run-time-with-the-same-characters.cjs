'use strict';
function join(head, tail) { return tail === undefined ? undefined : head + tail; }
function same(a, b) { return a === b; }
const heads = ['river', 'rive', 'riv']; const tails = ['bank', 'rbank', 'erbank', undefined];
const n = +process.argv[2] || 300; let out = ''; for (let t = 0; t < n; t++) { out = ''; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) out += same(join(heads[i % 3], tails[i >> 2 | (i & 1) << 1]), join(heads[j % 3], tails[j >> 2 | (j & 1) << 1])) ? '1' : '0'; } console.log(out);
