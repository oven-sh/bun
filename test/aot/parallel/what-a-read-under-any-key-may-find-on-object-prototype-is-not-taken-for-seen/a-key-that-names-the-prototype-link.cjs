'use strict';
function go(x) { return x + 1; }
function back(x) { return x - 1; }
const table = { go, back }, keys = JSON.parse('["go", "__proto__", "back"]');
function run(key, turns) { let s = ''; const h = table[key]; for (let i = 0; i < turns; i++) s += h(i); return s; }
const seen = [];
for (const key of keys) { try { seen.push(String(run(key, 3))); } catch (error) { seen.push(error.constructor.name); } }
console.log(seen.join('|'));
