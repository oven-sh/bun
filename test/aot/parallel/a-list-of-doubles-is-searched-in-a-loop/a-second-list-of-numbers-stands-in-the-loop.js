// STATISTIC: UnrolledLoopsForIndexingType >= 6
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function weigh(l, w, x) { let sum = 0; for (let i = 0; i < l.length; i++) { if (l[i] !== x) sum += w[i]; } return sum; }
const row = (length, step) => JSON.parse("[" + Array.from({ length }, (_, i) => i * step + 0.5).join() + "]");
for (let t = 0; t < n; t++) { said.length = 0; const texts = JSON.parse('["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t"]'), whole = JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]"); const lists = [row(20, 1), texts, whole], weights = [row(20, 0.25), whole]; for (const l of lists) for (const w of weights) said.push(weigh(l, w, 3.5), weigh(l, w, "c"), weigh(l, w, 4)); } console.log(said.join());
