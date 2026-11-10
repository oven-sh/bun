"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function sum(rows, k) { let s = 0; for (let i = 0; i < rows[k].length; i++) s += rows[k][i]; return s; }
const go = hidden(sum);
let asked = 0; const rows = [[1, 2]]; Object.defineProperty(rows, 1, { get() { asked++; return [5.5, 6.5, 7.5]; } });
said.push(go(rows, hidden(1)), asked, go(rows, hidden(0)), asked);
console.log(said.join(" | "));
