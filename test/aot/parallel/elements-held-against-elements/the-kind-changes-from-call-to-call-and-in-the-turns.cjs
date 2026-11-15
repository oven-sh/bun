"use strict";
function shared(a, b, swap) { let n = 0; for (let i = 0; i < a.length; i++) { for (let j = 0; j < b.length; j++) { if (a[i] === b[j]) n++; if (swap && j === 1) { const t = a; a = b; b = t; } } } return n; }
function grows(a, b) { let n = 0; for (let i = 0; i < a.length; i++) { for (let j = 0; j < b.length; j++) { if (a[i] === b[j]) { n++; if (Array.isArray(b) && b.length < 9) b.push(a[i]); } } } return n; }
const given = JSON.parse('["harbor", ["h", "a", "r"], "rah", ["r", "r"]]');
const said = [];
for (let t = 0; t < 64; t++) said.push(shared(given[t & 3], given[(t >> 2) & 3], (t >> 4) & 1));
for (let t = 0; t < 16; t++) said.push(grows(given[t & 3], JSON.parse(JSON.stringify(given[(t >> 2) & 3]))));
console.log(said.join(" "));
