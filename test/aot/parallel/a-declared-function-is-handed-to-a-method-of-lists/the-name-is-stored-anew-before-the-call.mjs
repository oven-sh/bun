const rows = JSON.parse(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: i, qty: 1 + (i % 4), name: "item" + i }))));
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };

let pick = function pick(row) { return row.qty * 2; };
function run(list) { return list.map(pick); }
console.log(say(run(rows)));
pick = function other(row) { return row.name; };
console.log(say(run(rows)));
var late = function (row) { return row.id; };
function runLate(list) { return list.map(late); }
console.log(say(runLate(rows)));
late = row => -row.id;
console.log(say(runLate(rows)));
