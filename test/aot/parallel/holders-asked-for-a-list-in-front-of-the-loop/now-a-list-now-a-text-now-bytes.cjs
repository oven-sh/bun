'use strict';
const shelf = new Map([['b', Buffer.alloc(3, 7)], ['c', 'xyz'], ['d', JSON.parse('[{"x":1}]')], ['e', JSON.parse('[1,2]')], ['f', 5], ['g', { length: 1, 0: 'g' }]]); let kept; const all = [JSON.parse('[1,2]'), 'ab', Buffer.from([5, 6]), JSON.parse('[0.5,"q"]'), { length: 1, 0: 'z' }];
function f(t) { shelf.set('a', all[t % 5]); const l = shelf.get('a'); let s = ''; for (let i = 0; i < l.length; i++) { kept = l[i]; s += typeof kept + kept + ','; } return s + (t > 4 ? '' : '!'); }
const n = +process.argv[2] || 3000; let out = ''; for (let t = 0; t < n; t++) { const got = String(f(t)); if (t >= n - 5) out += got + ';'; } console.log(out);
