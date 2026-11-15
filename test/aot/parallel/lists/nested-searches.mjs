// Searches within searches in a method that a loop calls: the arrays that the inner callback reads are tested before both loops.
// STATISTIC: CallbackChainsFused <= 2
// STATISTIC: AllocationsSunk >= 5
class Grid {
  cells = new Array(42).fill(0);
  wins(cell, player) { return lines[cell].some(line => line.cells.every(c => this.cells[c] === player)); }
  count(player) { let t = 0; for (let k = 0; k < 42; k++) if (this.wins(k, player)) t++; return t; }
}
const lines = Array.from({ length: 42 }, (_, cell) => Array.from({ length: 3 }, (_, k) => ({ cells: [0, 1, 2, 3].map(d => (cell + d * (k + 1)) % 42) })));
const grid = new Grid();
let total = 0;
const n = Number(process.argv[2] ?? 20);
for (let k = 0; k < n; k++) { grid.cells[(k * 7) % 42] = 1 + (k & 1); total += grid.count(1) + grid.count(2) * 3; if (k % 40 === 39) grid.cells.fill(0); }
console.log(total);
