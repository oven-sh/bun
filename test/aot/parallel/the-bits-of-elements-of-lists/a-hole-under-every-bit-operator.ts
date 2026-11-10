// STATISTIC: UnrolledLoopsForIndexingType >= 1
function even(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) { const cell = cells[j]!; if ((cell & 1) === 0) t++; } return t; }
function forOf(cells: number[]): number { let t = 0; for (const cell of cells) if ((cell & 1) === 0) t++; return t; }
function and(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t += cells[j]! & 5; return t; }
function or(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t += cells[j]! | 2; return t; }
function xor(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t ^= cells[j]!; return t; }
function not(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t += ~cells[j]!; return t; }
function left(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t += cells[j]! << 2; return t; }
function by(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t += 1 << cells[j]!; return t; }
function right(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t += cells[j]! >> 1; return t; }
function unsigned(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t += cells[j]! >>> 28; return t; }
function twice(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t += cells[j]! * 2; return t; }
function once(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t += cells[j]! * 1; return t; }
function nothing(cells: number[]): number { let t = 1; for (let j = 0; j < cells.length; j++) t += cells[j]! * 0; return t; }
function plusOne(cells: number[]): number { let t = 0; for (let j = 0; j < cells.length; j++) t += cells[j]! + 1; return t; }
const all = [even, forOf, and, or, xor, not, left, by, right, unsigned, twice, once, nothing, plusOne];
for (const n of [4, 7, 8, 9, 20]) for (const hole of [-1, 0, 1, 3, 7, 8, 19]) { if (hole >= n) continue;
  const whole: number[] = new Array(n), small: number[] = new Array(n), halves: number[] = new Array(n);
  for (let i = 0; i < n; i++) if (i !== hole) { whole[i] = i * 3 - 4; small[i] = (i * 3 - 4) | 0; halves[i] = i * 1.5 - 2; }
  console.log(n, hole, all.map(f => f(whole)).join(), all.map(f => f(small)).join(), all.map(f => f(halves)).join());
}
