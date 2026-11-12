// `rows[y][x] === '#'` fits a text and a list of characters alike. Both come, and both in one list; so do rows that are neither.
"use strict";
const LINES = JSON.parse('["..#..#", "#.....", "......", "###..."]');
const CELLS = JSON.parse('[[".",".","#"],["#","#"],[],[".","#",".","#"]]');
const BOTH = JSON.parse('["#.#", ["#", ".", "#"], "", [], "##", [35, "#", null, ["#"]], 7, {"length": 2, "0": "#", "1": "."}]');
function inLines() { let s = 0; for (let y = 0; y < LINES.length; y++) for (let x = 0; x < LINES[y].length; x++) if (LINES[y][x] === "#") s += x + y * 10; return s; }
function inCells() { let s = 0; for (let y = 0; y < CELLS.length; y++) for (let x = 0; x < CELLS[y].length; x++) if (CELLS[y][x] === "#") s += x + y * 10; return s; }
function inBoth() { let s = 0; for (let y = 0; y < BOTH.length; y++) for (let x = 0; x < BOTH[y].length; x++) if (BOTH[y][x] === "#") s += x + y * 10; return s; }
function made(t) { const g = LINES.map(l => l.split("")); let s = t & 1; for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x] === "#") s += x + y; return s; }
const said = [];
for (let round = 0; round < 200; round++) { inLines(); inCells(); inBoth(); made(round); }
said.push(inLines(), inCells(), inBoth(), made(1));
CELLS[1] = "##"; LINES[2] = ["#"]; BOTH.push(null);
said.push(inLines(), inCells());
try { said.push(inBoth()); } catch (error) { said.push(error.constructor.name); }
console.log(said.join(" | "));
