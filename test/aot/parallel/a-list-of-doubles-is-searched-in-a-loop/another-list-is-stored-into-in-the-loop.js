// STATISTIC: LoopsLaidOutForOneKindOfStorage >= 9
// Under: --aot-testing=EmittersAloneTestEveryPosition: the turns are laid out as users build them, and every raw access asks its position at the run
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function mark(l, marks, x) { for (let i = 0; i < l.length; i++) marks[i] = l[i] === x ? 1 : 0; return marks; }
const row = (length, step) => JSON.parse("[" + Array.from({ length }, (_, i) => i * step + 0.5).join() + "]");
for (let t = 0; t < n; t++) { said.length = 0; const lists = [row(20, 1), JSON.parse('["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t"]'), JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]")]; for (const l of lists) said.push(mark(l, new Array(20).fill(0), 3.5).join(""), mark(l, row(20, 1), "c").join(""), mark(l, [], 4).join("")); } console.log(said.join());
