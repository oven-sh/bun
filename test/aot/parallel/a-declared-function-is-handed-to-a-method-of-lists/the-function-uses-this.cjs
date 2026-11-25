const rows = JSON.parse(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: i, qty: 1 + (i % 4), name: "item" + i }))));
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };
function sloppy(row) { return typeof this + ":" + (this === globalThis) + ":" + (this && this.scale ? row.qty * this.scale : row.qty); }
function run(list, given) { return [list.map(sloppy), list.map(sloppy, given), list.map(sloppy, 5).length, list.some(sloppy, null), list.filter(sloppy, given).length]; }
console.log(say(run(rows.slice(0, 3), { scale: 10 })));
