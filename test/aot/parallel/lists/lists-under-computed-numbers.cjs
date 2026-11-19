// Lists that are stored under computed numbers: some numbers are no indexes and become names. Reads of them run no code, and one that nothing has changed is not made again.
"use strict";
const log = [];
function Node(x, y, weight) { this.x = x; this.y = y; this.weight = weight; }
function Grid(rows) {
  this.grid = []; this.nodes = [];
  for (let x = 0; x < rows.length; x++) {
    this.grid[x] = [];
    for (let y = 0, row = rows[x]; y < row.length; y++) { const node = new Node(x, y, row[y]); this.grid[x][y] = node; this.nodes.push(node); }
  }
}
Grid.prototype.neighbors = function (node) {
  const ret = [], x = node.x, y = node.y, grid = this.grid;
  if (grid[x - 1] && grid[x - 1][y]) ret.push(grid[x - 1][y]);
  if (grid[x + 1] && grid[x + 1][y]) ret.push(grid[x + 1][y]);
  if (grid[x] && grid[x][y - 1]) ret.push(grid[x][y - 1]);
  if (grid[x] && grid[x][y + 1]) ret.push(grid[x][y + 1]);
  return ret;
};
const id = n => n ? n.x + "." + n.y : String(n);
const g = new Grid([[1, 0, 1, 1], [1, 1, 1], [0, 1, 1, 1, 1], []]);
let sum = 0;
for (let turn = 0; turn < 30; turn++) for (const n of g.nodes) for (const m of g.neighbors(n)) sum += m.weight * (m.x + 1) + m.y;
log.push(sum, g.nodes.map(n => g.neighbors(n).map(id).join()).join(";"));
// A row that is a name: grid[-1] and grid[1][-1] hold nodes.
g.grid[-1] = [new Node("a", "b", 5)]; g.grid[1][-1] = new Node("c", "d", 6); g.grid[2][1.5] = new Node("e", "f", 7);
log.push(g.nodes.map(n => g.neighbors(n).map(id).join()).join(";"), Object.keys(g.grid).join(), g.grid[-1].length, id(g.grid[2][0.5 + 1]));
g.grid.length = 2; g.grid[4] = [new Node(4, 0, 1)]; delete g.grid[0][1];
log.push(g.nodes.map(n => g.neighbors(n).map(id).join()).join(";"), 3 in g.grid, g.grid.length);
// The heap: a list in a field, stored under numbers that a step computes.
function Heap() { this.content = []; }
Heap.prototype.push = function (v) { this.content.push(v); this.up(this.content.length - 1); };
Heap.prototype.up = function (n) { const v = this.content[n]; while (n > 0) { const p = ((n + 1) >> 1) - 1, w = this.content[p]; if (v.weight < w.weight) { this.content[p] = v; this.content[n] = w; n = p; } else break; } };
Heap.prototype.pop = function () { const top = this.content[0], end = this.content.pop(); if (this.content.length) { this.content[0] = end; this.down(0); } return top; };
Heap.prototype.down = function (n) { const c = this.content, v = c[n]; for (;;) { let k = 2 * n + 1; if (c[k + 1] && c[k + 1].weight < c[k].weight) k++; if (c[k] && c[k].weight < v.weight) { c[n] = c[k]; c[k] = v; n = k; } else return; } };
const heap = new Heap(), order = [];
for (let i = 0; i < 60; i++) heap.push(new Node(i, 0, (i * 37) % 61));
while (heap.content.length) order.push(heap.pop().weight);
log.push(order.join(), heap.pop(), heap.content[-1], heap.content[0]);
// A store between two reads, by this function, by another, under another name and under a name that may be the same.
function pair(list, i, j) { const a = list[i]; list[j] = a; const b = list[i]; list[i] = list[j + 1]; return id(a) + id(b) + id(list[i]) + id(list[j]); }
function bump(list, i) { list[i] = new Node(i, i, i); return i; }
function around(list, i) { const a = list[i]; bump(list, i); const b = list[i]; list.length = Math.max(0, i); return id(a) + "|" + id(b) + "|" + id(list[i]); }
const row = g.grid[1];
for (let i = -2; i < 4; i++) log.push(pair(row, i, i + 1), pair(row, i + 1, i), pair(row, i * 0.5, i));
for (let i = 5; i > -3; i--) log.push(around(row, i));
log.push(Object.keys(row).join(), row.length);
for (const line of log) console.log(line);
