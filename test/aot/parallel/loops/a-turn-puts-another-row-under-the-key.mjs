"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function sum(rows, k, other) { let s = 0; for (let i = 0; i < rows[k].length; i++) { s += rows[k][i]; if (i === 1) rows[k] = other; } return s; }
const go = hidden(sum);
const rows = [[1, 2, 3, 4], [10, 20]];
said.push(go(rows, hidden(0), [100.5, 200.5, 300.5, 400.5, 500.5]), rows[0].length);
console.log(said.join(" | "));
