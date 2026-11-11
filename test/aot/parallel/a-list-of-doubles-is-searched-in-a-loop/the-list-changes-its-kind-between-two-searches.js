// STATISTIC: UnrolledLoopsForIndexingType >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function find(l, x) { for (let i = 0; i < l.length; i++) { if (l[i] === x) return i; } return -1; }
const row = (length, step) => JSON.parse("[" + Array.from({ length }, (_, i) => i * step + 0.5).join() + "]");
for (let t = 0; t < n; t++) { said.length = 0; const l = JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12]"); const deeds = [() => 0, () => { l[3] = 0.25; }, () => { l[5] = "text"; }, () => { l.length = 4; }, () => { l.length = 0; }, () => { for (let i = 0; i < 12; i++) l[i] = i + 0.25; }]; for (const deed of deeds) { deed(); const lists = [l, row(12, 1)]; for (const each of lists) said.push(find(each, 9), find(each, 0.25), find(each, "text"), find(each, 8.5)); } } console.log(said.join());
