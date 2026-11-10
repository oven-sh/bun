// STATISTIC: ListsExpectedOfPlaces >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const D = JSON.parse('[3,5,7,9,' + q + ']'); let kept;
function f(t) { let hits = 0; for (let i = 0; i < D.length; i++) { kept = D[i]; if (D[i] === q) hits++; } return hits + ':' + kept + ':' + t; }
let last; for (let t = 0; t < 40; t++) last = f(t); console.log(last);
