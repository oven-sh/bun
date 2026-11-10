const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };

function scaled(scale, row) { return row * scale; }
const byTen = scaled.bind(null, 10);
function run(list) { return [list.map(byTen), list.map(parseInt), list.map(Number), list.map(String), list.map(Math.sqrt), list.filter(Boolean), list.map(Array.isArray), list.every(isNaN), list.map(Number.isInteger)]; }
console.log(say(run(["1", "2", "3", "10", "11", "", "x"]))); console.log(say(run([4, 9, 0, -1, 2.5])));
