// STATISTIC: ListsExpectedOfPlaces >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const V = q > 99 ? JSON.parse(process.argv[3]) : Float32Array.from([1.5, 2, q]), T = JSON.parse('"héllo' + q + '"'); let kept = '';
function f(t) { let s = t; for (let i = 0; i < V.length; i++) s = s + V[i]; return s; }
function g(t) { let n = 0; for (let i = 0; i < T.length; i++) { kept = T[i]; n += kept.length; } return n + kept + t; }
let all = 0, last; for (let t = 0; t < 40; t++) { all += f(t); last = g(t); } console.log(all, last);
