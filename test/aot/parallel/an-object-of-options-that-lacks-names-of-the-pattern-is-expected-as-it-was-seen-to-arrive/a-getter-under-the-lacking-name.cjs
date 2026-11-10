"use strict";
function shape(x, { width = "", height, depth, tint = x } = {}) { return x + width.length + (tint === x ? 1 : 0) + (depth === undefined ? 10 : depth) + (height === undefined ? 100 : height); }
const table = { shape }, key = JSON.parse("\"shape\"");
let asked = 0;
const given = { width: "q", height: 1 }, other = { width: "q", height: 1, get depth() { asked++; return asked; } };
function run(turns) { let s = 0; const h = table[key]; for (let i = 0; i < turns; i++) s += h(i, i & 1 ? other : given); return s; }
console.log(run(8), asked);
