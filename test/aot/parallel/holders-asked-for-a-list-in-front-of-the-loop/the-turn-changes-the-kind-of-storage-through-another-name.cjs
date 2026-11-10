'use strict';
const shelf = new Map([['b', Buffer.alloc(3, 7)], ['c', 'xyz'], ['d', JSON.parse('[{"x":1}]')], ['e', JSON.parse('[1,2]')], ['f', 5], ['g', { length: 1, 0: 'g' }]]); let kept; let other;
function f(t) { other = [1, 2, 3, 4]; shelf.set('a', other); const l = shelf.get('a'); let s = ''; for (let i = 0; i < l.length; i++) { kept = l[i]; s += typeof kept + kept + ','; if (i === 0) other[2] = 0.5; if (i === 1) other[3] = 'text'; } return s; }
const n = +process.argv[2] || 3000; let out = ''; for (let t = 0; t < n; t++) out = String(f(t)); console.log(out);
