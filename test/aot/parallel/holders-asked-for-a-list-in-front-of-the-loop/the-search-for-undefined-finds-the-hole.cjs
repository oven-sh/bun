'use strict';
const shelf = new Map([['b', Buffer.alloc(3, 7)], ['c', 'xyz'], ['d', JSON.parse('[{"x":1}]')], ['e', JSON.parse('[1,2]')], ['f', 5], ['g', { length: 1, 0: 'g' }]]); let kept; const all = [[1, , 3], [0.5, , 1.5], [1, 2, 3], ['a', , 'c'], [undefined, 1], [null, 2]];
function f(t) { shelf.set('a', all[t % 6]); const l = shelf.get('a'), x = undefined; for (let i = 0; i < l.length; i++) if (l[i] === x) return i; return -1; }
const n = +process.argv[2] || 3000; let out = ''; for (let t = 0; t < n; t++) { const got = String(f(t)); if (t >= n - 6) out += got + ';'; } console.log(out);
