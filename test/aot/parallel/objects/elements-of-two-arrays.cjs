// A method fills every element of an array. The elements of another array as well take as many bytes as those of that array alone.
"use strict";
const single = {
    wash(node) { node.p = 0; node.q = 0; node.r = 0; node.seen = false; node.done = false; node.owner = null; },
};
function Node(left, right, cost) { this.left = left; this.right = right; this.cost = cost; }
function Row(size) {
    this.nodes = [];
    for (let i = 0; i < size; i++) this.nodes.push(new Node(i, i, i % 3));
    this.init();
}
Row.prototype.init = function () {
    for (let i = 0; i < this.nodes.length; i++) single.wash(this.nodes[i]);
};

const both = {
    clean(cell) { cell.f = 0; cell.g = 0; cell.h = 0; cell.visited = false; cell.closed = false; cell.parent = null; },
};
function Cell(x, y, weight) { this.x = x; this.y = y; this.weight = weight; }
function Board(size) {
    this.cells = [];
    this.rows = [];
    for (let x = 0; x < size; x++) {
        this.rows[x] = [];
        for (let y = 0; y < size; y++) {
            const cell = new Cell(x, y, (x * y) % 3);
            this.rows[x][y] = cell;
            this.cells.push(cell);
        }
    }
    this.reset();
}
Board.prototype.reset = function () {
    for (let i = 0; i < this.cells.length; i++) both.clean(this.cells[i]);
};

// A few of many objects are elements of the array that is filled: the others need no room for the names.
const few = {
    fill(entry) { entry.f0 = 1; entry.f1 = 1; entry.f2 = 1; entry.f3 = 1; entry.f4 = 1; entry.f5 = 1; entry.f6 = 1; entry.f7 = 1; entry.f8 = 1; entry.f9 = 1; entry.f10 = 1; entry.f11 = 1; entry.f12 = 1; entry.f13 = 1; entry.f14 = 1; entry.f15 = 1; },
};
function Entry(n) { this.n = n; }
function Store(size) {
    this.all = [];
    this.first = [];
    for (let i = 0; i < size; i++) {
        const entry = new Entry(i);
        this.all.push(entry);
        if (i < 3) this.first.push(entry);
    }
    this.reset();
}
Store.prototype.reset = function () {
    for (let i = 0; i < this.first.length; i++) few.fill(this.first[i]);
};

function heap() { Bun.gc(true); return process.memoryUsage().heapUsed; }
const heaps = [heap()];
const row = new Row(62500);
heaps.push(heap());
const board = new Board(250);
heaps.push(heap());
const store = new Store(62500);
heaps.push(heap());
const [bytesOfNode, bytesOfCell, bytesOfEntry] = [0, 1, 2].map(i => (heaps[i + 1] - heaps[i]) / 62500);
board.rows[3][4].parent = board.rows[2][4];
board.rows[2][4].f = 1.5;
let sum = 0;
for (const cell of board.cells) sum += cell.f + cell.g + cell.h + cell.weight + (cell.visited ? 1 : 0) + (cell.parent ? cell.parent.x : 0);
for (const node of row.nodes) sum += node.p + node.cost;
if (process.env.SHOW) console.log(bytesOfNode, bytesOfCell, bytesOfEntry);
console.log(bytesOfCell < bytesOfNode * 1.3 ? "alike" : "larger", bytesOfEntry < 80 ? "small" : "large", sum, Object.keys(board.cells[7]).join(), Object.keys(store.all[2]).length, Object.keys(store.all[3]).length);
