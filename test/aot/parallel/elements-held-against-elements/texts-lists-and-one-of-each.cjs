"use strict";
function shared(a, b) { const row = [0]; let n = 0; for (let i = 0; i < a.length; i++) { for (let j = 0; j < b.length; j++) { row[j + 1] = row[j] + (a[i] === b[j] ? 1 : 0); } n += row[b.length]; } return n; }
const given = JSON.parse('["harbor", "orchard", ["h", "a", 7], ["a", 7, 7], "", [], "\\u00fcber \\ud83d\\ude00", ["\\ud83d", "r", null]]');
const said = [];
for (let x = 0; x < given.length; x++) for (let y = 0; y < given.length; y++) said.push(shared(given[x], given[y]));
console.log(said.join(" "));
