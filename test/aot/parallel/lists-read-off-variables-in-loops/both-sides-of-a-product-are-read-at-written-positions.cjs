"use strict";
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
const first = JSON.parse(process.argv[2] ?? "[0.5,1.5,2.5]"), second = JSON.parse(process.argv[3] ?? "[1.5,2.5,3.5]");
function sum(start) { let total = start; for (let turn = 0; turn < 100; turn++) total += dot(first, second); return total; }
console.log("SAID", sum(0), sum(1));
