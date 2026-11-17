// A loop that pushes onto another array in each iteration reserves nothing for its remaining iterations.
"use strict";
const N = Number(process.env.LENGTH ?? 150), R = 100;
const object = { a: 1 };
function heap() { Bun.gc(true); return process.memoryUsage().heapUsed; }
const kept = [], said = [];
function check(name, build) {
    const before = heap();
    const rows = build(N * R);
    kept.push(rows);
    const bytes = (heap() - before) / R;
    if (process.env.SHOW) console.log(name, Math.round(bytes));
    said.push(name + (bytes < 33 * N ? " small" : " large"));
}
const lists = () => { const rows = []; for (let i = 0; i < R; i++) rows.push([]); return rows; };
check("rows", n => { const rows = lists(); for (let i = 0; i < n; i++) rows[i % R].push(object); return rows; });
check("numbers", n => { const rows = lists(); for (let i = 0; i < n; i++) rows[i % R].push(i); return rows; });
check("doubles", n => { const rows = lists(); for (let i = 0; i < n; i++) rows[i % R].push(i / 4); return rows; });
check("name", n => { const rows = lists(); for (let i = 0; i < n; i++) { const row = rows[i % R]; row.push(object); } return rows; });
check("pairs", n => { const rows = lists(); for (let i = 0; i < n / 2; i++) rows[i % R].push(object, i); return rows; });
check("fields", n => { const nodes = []; for (let i = 0; i < R; i++) nodes.push({ children: [], n: i }); for (let i = 0; i < n; i++) nodes[i % R].children.push(object); return nodes; });
check("map", n => { const map = new Map(); for (let i = 0; i < R; i++) map.set(i, []); for (let i = 0; i < n; i++) map.get(i % R).push(object); return map; });
check("call", n => { const rows = lists(); function pick(i) { return rows[i % R]; } for (let i = 0; i < n; i++) pick(i).push(object); return rows; });
check("next", n => { let first = null; for (let i = 0; i < R; i++) first = { list: [], next: first }; let last = first; while (last.next) last = last.next; last.next = first; let node = first; for (let i = 0; i < n; i++) { node.list.push(object); node = node.next; } return first; });
check("edges", n => { const graph = lists(); for (let i = 0; i < n / 2; i++) { const from = i % R, to = (i * 7 + 3) % R; graph[from].push(to); graph[to].push(from); } return graph; });
function rowsOfParameter(n) { const grid = []; for (let i = 0; i < R; i++) grid.push([]); for (let i = 0; i < n; i++) grid[i % R].push(object); return grid; }
check("grid", rowsOfParameter);
class Table { constructor() { this.rows = lists(); } fill(n) { for (let i = 0; i < n; i++) this.rows[i % R].push(object); return this.rows; } }
check("table", n => new Table().fill(n));
function turns(a, b, n) { for (let i = 0; i < n; i++) (i & 1 ? a : b).push(object); return [a, b]; }
check("turns", n => { const pairs = []; for (let i = 0; i < R / 2; i++) pairs.push(...turns([], [], N * 2)); return pairs; });
// One array takes the room at once, and no more than it needs.
check("one", n => { const all = []; for (let i = 0; i < n; i++) all.push(object); return all; });
class Holder { constructor() { this.all = []; } fill(n) { for (let i = 0; i < n; i++) this.all.push(object); return this; } }
check("held", n => new Holder().fill(n));
let total = 0;
for (const rows of kept) for (const row of rows instanceof Map ? rows.values() : Array.isArray(rows) && Array.isArray(rows[0]) ? rows : []) total += row.length;
console.log(said.join(", "), total);
