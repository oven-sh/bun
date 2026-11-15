'use strict';
const shelf = new Map([['b', Buffer.alloc(3, 7)], ['c', 'xyz'], ['d', JSON.parse('[{"x":1}]')], ['e', JSON.parse('[1,2]')], ['f', 5], ['g', { length: 1, 0: 'g' }]]); let kept; const all = [[0.5, , 1.5, NaN], [1, , 3, -0], [1, 2, 3, 4], [-0, 0.25, , ,], ['a', , 2, 0.5], [2 ** 31, -(2 ** 31) - 1, 1e21, 5]];
function f(t) { shelf.set('a', all[t % 6]); const l = shelf.get('a'), o = new Array(4); for (let i = 0; i < l.length; i++) o[i] = l[i]; return (1 in o) + ':' + Object.is(o[3], -0) + ':' + Object.is(o[0], -0) + ':' + o.join('|'); }
const n = +process.argv[2] || 3000; let out = ''; for (let t = 0; t < n; t++) { const got = String(f(t)); if (t >= n - 6) out += got + ';'; } console.log(out);
