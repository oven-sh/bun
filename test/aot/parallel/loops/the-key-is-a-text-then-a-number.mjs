"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function sum(rows, k) { let s = 0; for (let i = 0; i < rows[k].length; i++) s += rows[k][i]; return s; }
const go = hidden(sum);
const rows = [[1, 2], [3.5, 4]]; const table = { a: [7, 8.5], b: [9] };
said.push(go(table, hidden("a")), go(rows, hidden(1)), go(rows, hidden("0")), go(table, hidden("b")));
console.log(said.join(" | "));
