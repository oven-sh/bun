'use strict';
const shelf = new Map([['b', Buffer.alloc(3, 7)], ['c', 'xyz'], ['d', JSON.parse('[{"x":1}]')], ['e', JSON.parse('[1,2]')], ['f', 5], ['g', { length: 1, 0: 'g' }]]); let kept; shelf.set('a', null);
function f(t) { shelf.set('a', [1, 2, 3, 4, 5]); const l = shelf.get('a'); let s = ''; for (let i = 0; i < l.length; i++) { kept = l[i]; s += kept + ','; if (i === 1) l.length = 3; } return s; }
const n = +process.argv[2] || 3000; let out = ''; for (let t = 0; t < n; t++) out = String(f(t)); console.log(out);
