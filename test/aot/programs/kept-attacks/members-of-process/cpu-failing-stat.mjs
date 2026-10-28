// Files that are not there, asked for under five async callers: what an application does at start-up when it looks for its settings.
import fs from "node:fs";
function probe(path) { try { return fs.lstatSync(path).size; } catch { return -1; } }
function probeStat(path) { try { return fs.statSync(path).size; } catch { return -1; } }
async function level5(i) { await null; let sum = 0; for (let k = 0; k < 10; k++) sum += probe("/nonexistent/" + i + "/" + k) + probeStat("/nonexistent/s" + k); return sum; }
async function level4(i) { return (await level5(i)) + 1; }
async function level3(i) { return (await level4(i)) + 1; }
async function level2(i) { return (await level3(i)) + 1; }
async function level1(i) { return (await level2(i)) + 1; }
let total = 0;
for (let i = 0; i < 500; i++) total += await level1(i);
console.log(total);
