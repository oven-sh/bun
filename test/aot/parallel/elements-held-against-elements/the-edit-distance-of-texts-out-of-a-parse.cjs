"use strict";
function distance(a, b) { let prev = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[b.length]; }
const words = JSON.parse('["the", "quick", "brown", "M\\u00fcnchen", "", "na\\u00efve", ["q", "u", "i", "t"], ["t", "h", "e", "n"]]');
const said = [];
for (const x of words) for (const y of words) said.push(distance(x, y));
console.log(said.join(" "));
