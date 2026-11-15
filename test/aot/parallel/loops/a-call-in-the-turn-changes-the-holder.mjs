"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function sum(rows, k, each) { let s = 0; for (let i = 0; i < rows[k].length; i++) { s += rows[k][i]; each(i); } return s; }
const go = hidden(sum);
const rows = [[1, 2, 3], [10.5, 20.5, 30.5]];
said.push(go(rows, hidden(0), hidden((i) => { if (i === 0) rows[0] = rows[1]; })));
console.log(said.join(" | "));
