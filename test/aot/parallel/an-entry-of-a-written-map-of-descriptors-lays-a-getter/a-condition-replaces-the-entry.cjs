"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
function make(again) { const made = {}; const map = { add: { get: function () { return add; } } }; if (again) map.add = { get: function () { return sub; } }; Object.defineProperties(made, map); return made; }
let said = "";
for (let i = 0; i < +(process.argv[2] ?? 6); i++) said += make(i % 2 === 0).add(5, 2) + ",";
console.log(said);
