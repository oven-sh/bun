"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function sum(rows, k) { let s = 0; for (let i = 0; i < rows[k].length; i++) s += rows[k][i]; return s; }
const go = hidden(sum);
let asked = 0; const key = { toString() { asked++; return "1"; } };
const rows = [[0], [1.5, 2.5, 3.5]];
said.push(go(rows, hidden(key)), asked, go(rows, hidden(1)), asked);
console.log(said.join(" | "));
