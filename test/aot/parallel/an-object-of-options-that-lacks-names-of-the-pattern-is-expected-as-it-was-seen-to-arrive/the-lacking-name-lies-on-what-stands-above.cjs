"use strict";
function shape(x, { width = "", height, depth, tint = x } = {}) { return x + width.length + (tint === x ? 1 : 0) + (depth === undefined ? 10 : depth) + (height === undefined ? 100 : height); }
const table = { shape }, key = JSON.parse("\"shape\"");
const above = { depth: 7 }, given = Object.create(above); given.width = "q"; given.height = 1;
const plain = { width: "qq", height: 2 };
function run(turns) { let s = 0; const h = table[key]; for (let i = 0; i < turns; i++) s += h(i, i & 1 ? given : plain); return s; }
console.log(run(7));
