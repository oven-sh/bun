"use strict";
const unknown = process.argv.length > 99;
function long() { let t = "a"; for (let i = 0; i < 19; i++) t = t + t; return t + t.slice(0, 500000); }
function run() {
const big = long();
for (let i = 0; i < 200; i++) new RegExp(big + i);
}
if (unknown) run();
console.log(new RegExp("a" + "b".toLowerCase()).source, [3, 1, 2].map(String).join("-"));
