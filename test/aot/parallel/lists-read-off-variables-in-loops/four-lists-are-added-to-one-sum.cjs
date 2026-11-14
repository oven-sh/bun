"use strict";
const a = JSON.parse(process.argv[2] ?? "[1,2,3]"), b = JSON.parse("[10,20,30]"), c = JSON.parse("[0.5,0.5,0.5]"), d = JSON.parse("[100,200,300]");
function sum(start) { let total = start; for (let place = 0; place < a.length; place++) total = total + a[place] + b[place] + c[place] + d[place]; return total; }
console.log("SAID", sum(0), sum(1));
