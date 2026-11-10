// STATISTIC: UnrolledLoopsForIndexingType >= 1
"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function sum(rows, k) { let s = 0; for (let i = 0; i < rows[k].length; i++) s += rows[k][i]; return s; }
const go = hidden(sum);
const rows = [null, [1.5, 2.5, 3], [4, 5]];
for (const k of JSON.parse("[1, 2, 1]")) said.push(go(rows, k));
console.log(said.join(" | "));
