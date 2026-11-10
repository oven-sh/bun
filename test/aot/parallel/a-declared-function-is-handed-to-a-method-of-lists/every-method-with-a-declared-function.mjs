const rows = JSON.parse(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: i, qty: 1 + (i % 4), name: "item" + i }))));
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };

function twice(row) { return row.qty * 2; }
function isSmall(row) { return row.qty < 3; }
function add(sum, row) { return sum + row.qty; }
function note(row) { noted.push(row.id); }
function pair(row) { return [row.id, row.qty]; }
const noted = [];
function all(list) { list.forEach(note); return [list.map(twice), list.filter(isSmall).length, list.find(isSmall), list.findIndex(isSmall), list.findLast(isSmall), list.findLastIndex(isSmall), list.some(isSmall), list.every(isSmall), list.reduce(add, 0), list.reduceRight(add, 0), list.flatMap(pair)]; }
for (let t = 0; t < 3; t++) console.log(say(all(rows)), say(noted.length));
console.log(say(all([])));
