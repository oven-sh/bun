// STATISTIC: LoopsWhoseTurnsAreLaidOut >= 10
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function find(l, x) { for (let i = 0; i < l.length; i++) { if (l[i] === x) return i; } return -1; }
for (let t = 0; t < n; t++) { said.length = 0; const lists = [JSON.parse('["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t"]'), JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]"), JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5,12.5,13.5,14.5,15.5,16.5,17.5,18.5,19.5]")]; for (const l of lists) said.push(find(l, "s"), find(l, 19), find(l, 18.5), find(l, "z")); } console.log(said.join());
