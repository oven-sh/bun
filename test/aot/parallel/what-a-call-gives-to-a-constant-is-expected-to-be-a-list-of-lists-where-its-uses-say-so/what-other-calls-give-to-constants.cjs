// Not JSON.parse alone: what a function of the program gives, what `new` gives, what is awaited; a constant in a function; a variable that is stored again bears no word.
"use strict";
function table(n) { const rows = []; for (let y = 0; y < n; y++) { const row = []; for (let x = 0; x < n; x++) row.push(x * y + 0.5); rows.push(row); } return globalThis.JSON.parse(JSON.stringify(rows)); }
const T = table(6);
function sumT() { let s = 0; for (let y = 0; y < T.length; y++) for (let x = 0; x < T[y].length; x++) s += T[y][x]; return s; }
function inside(text) { const local = JSON.parse(text); let s = 0; for (let y = 0; y < local.length; y++) for (let x = 0; x < local[y].length; x++) s += local[y][x]; return s; }
let again = JSON.parse("[[1,2],[3]]");
function sumAgain() { let s = 0; for (let y = 0; y < again.length; y++) for (let x = 0; x < again[y].length; x++) s += again[y][x]; return s; }
async function awaited() { const late = await Promise.resolve(JSON.parse("[[1,2,3],[4,5]]")); let s = 0; for (let y = 0; y < late.length; y++) for (let x = 0; x < late[y].length; x++) s += late[y][x]; return s; }
const said = [];
for (let round = 0; round < 100; round++) { sumT(); inside("[[1,2],[3,4]]"); sumAgain(); }
said.push(sumT(), inside("[[1,2],[3,4.5]]"), inside('["ab",[1]]'), sumAgain());
again = ["xy", [5]];
said.push(sumAgain());
awaited().then(sum => { said.push(sum); console.log(said.join(" | ")); });
