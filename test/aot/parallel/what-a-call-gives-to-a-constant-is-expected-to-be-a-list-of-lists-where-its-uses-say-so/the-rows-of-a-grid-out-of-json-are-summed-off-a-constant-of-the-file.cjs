// STATISTIC: LoopsWhoseTurnsAreLaidOut >= 1
// G is a constant of the file that JSON.parse gives. Its uses say a list of lists of numbers: the loops are typed as where the grid is handed in as a parameter.
"use strict";
const G = JSON.parse("[" + Array.from({ length: 10 }, (_, y) => "[" + Array.from({ length: 12 }, (_, x) => (x * 7 + y * 5) % 11).join() + "]").join() + "]");
function f(t) { let s = t & 1; for (let y = 0; y < G.length; y++) for (let x = 0; x < G[y].length; x++) s = s + G[y][x]; return s; }
let sum = 0;
for (let t = 0; t < 300; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
