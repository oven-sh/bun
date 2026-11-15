'use strict';
const shelf = new Map([['b', Buffer.alloc(3, 7)], ['c', 'xyz'], ['d', JSON.parse('[{"x":1}]')], ['e', JSON.parse('[1,2]')], ['f', 5], ['g', { length: 1, 0: 'g' }]]); let kept; const all = [[1, 2, 3], [0.5, 2, 3.5]], sought = ['2', 2, 2n, null, true, 2.0000000001, -0];
function f(t) { shelf.set('a', all[t & 1]); const l = shelf.get('a'), x = sought[t % 7]; for (let i = 0; i < l.length; i++) if (l[i] === x) return i; return -1; }
const n = +process.argv[2] || 3000; let out = ''; for (let t = 0; t < n; t++) { const got = String(f(t)); if (t >= n - 6) out += got + ';'; } console.log(out);
