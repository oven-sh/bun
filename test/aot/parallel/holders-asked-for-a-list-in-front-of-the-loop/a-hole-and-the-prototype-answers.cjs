'use strict';
const shelf = new Map([['b', Buffer.alloc(3, 7)], ['c', 'xyz'], ['d', JSON.parse('[{"x":1}]')], ['e', JSON.parse('[1,2]')], ['f', 5], ['g', { length: 1, 0: 'g' }]]); let kept; const low = [1, , 3]; Object.setPrototypeOf(low, { 1: 'from above', __proto__: Array.prototype }); shelf.set('a', low);
function f(t) { const l = shelf.get('a'); let s = ''; for (let i = 0; i < l.length; i++) { kept = l[i]; s += typeof kept + ':' + String(kept) + ','; } return s; }
const n = +process.argv[2] || 3000; let out = ''; for (let t = 0; t < n; t++) out = String(f(t)); console.log(out);
