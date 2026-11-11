"use strict";
function shape(x, { width = "", height, depth, tint = x } = {}) { return x + width.length + (tint === x ? 1 : 0) + (depth === undefined ? 10 : depth) + (height === undefined ? 100 : height); }
const table = { shape }, key = JSON.parse("\"shape\"");
const given = { width: "q", height: 1 };
function run(turns) { let s = 0; const h = table[key]; for (let i = 0; i < turns; i++) s += h(i, given); return s; }
console.log(run(7));
