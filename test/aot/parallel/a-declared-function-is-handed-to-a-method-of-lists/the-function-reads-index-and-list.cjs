const rows = JSON.parse(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: i, qty: 1 + (i % 4), name: "item" + i }))));
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };

function withPlace(row, index, list) { return row.qty * 100 + index * 10 + list.length + arguments.length; }
function sums(sum, row, index, list) { return sum + index + list.length + arguments.length; }
function run(list) { return [list.map(withPlace), list.reduce(sums, 0), list.reduce(sums)]; }
console.log(say(run(rows))); console.log(say(run([{ qty: 1 }])));
