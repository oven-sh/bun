const rows = JSON.parse(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: i, qty: 1 + (i % 4), name: "item" + i }))));
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };

console.log(say(run(rows.slice(0, 3))));
function run(list) { return list.map(below); }
function below(row) { return row.id + 1; }
function outer(list, k) { function inner(row) { return row.qty + k; } return list.map(inner); }
console.log(say(outer(rows.slice(0, 3), 5)), say(outer(rows.slice(0, 3), 7)));
function shadowed(list, below) { return list.map(below); }
console.log(say(shadowed(rows.slice(0, 2), row => "given " + row.id)));
{ function block(row) { return "block " + row.id; } console.log(say(rows.slice(0, 2).map(block))); }
const recursive = list => list.map(walk); function walk(x) { return Array.isArray(x) ? x.map(walk) : x * 2; }
console.log(say(recursive([1, [2, [3, [4]]], 5])));
