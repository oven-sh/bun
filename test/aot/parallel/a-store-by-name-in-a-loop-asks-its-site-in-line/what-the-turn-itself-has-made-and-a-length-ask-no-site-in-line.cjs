// A store into what the same turn has made adds the name every time, and a length is no own word: neither asks its site in line.
// STATISTIC: SiteCachedStoresEmittedInline = 0
"use strict";
const said = [];
function closures(turns) { let sum = 0; for (let i = 0; i < turns; i++) { const grip = x => x + i; grip.lid = (a, b) => b; sum = (sum + grip(1) + grip.lid(0, i)) | 0; } return sum; }
function lists(turns) { let sum = 0; for (let i = 0; i < turns; i++) { const row = [i, i + 1]; row.lid = i; sum = (sum + row.lid + row.length) | 0; } return sum; }
function shorten(rows, turns) { let sum = 0; for (let i = 0; i < turns; i++) { const row = rows[i & 1]; row.length = 1 + (i & 3); sum = (sum + row.length) | 0; } return sum; }
said.push(closures(3000), lists(3000), shorten(JSON.parse("[[1,2,3,4,5],[6,7,8,9]]"), 3000));
console.log(said.join(" | "));
