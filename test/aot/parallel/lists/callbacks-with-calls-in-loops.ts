// In a loop, a method of lists is copied for a callback that is written in place even where the callback calls: what it calls may change the list, throw, or come back here.
// STATISTIC: ArrayCallbacksInlinedWithCalls >= 5
const rows: { id: number; cells: number[] }[] = JSON.parse('[{"id":1,"cells":[1,2,3]},{"id":2,"cells":[]},{"id":3,"cells":[4,0,6]},{"id":4,"cells":[7]}]');
const log: string[] = [];
let calls = 0;
function weigh(value: number, by: number): number {
  calls++;
  if (value > 900) throw new RangeError("too heavy: " + value);
  return (value * 31 + by) % 1009;
}
function total(cells: number[]): number {
  let sum = 0;
  for (const cell of cells) sum += weigh(cell, 3);
  return sum;
}
class Board {
  constructor(readonly cells: number[], readonly owner: number) {}
  isAt(cell: number): boolean {
    return weigh(this.cells[cell] ?? 0, this.owner) % 2 === 1;
  }
  wins(lines: { cells: number[] }[]): boolean {
    return lines.some(line => line.cells.every(cell => this.isAt(cell)));
  }
}
const lines = [{ cells: [0, 1] }, { cells: [2] }, { cells: [] as number[] }];
let wins = 0;
for (let turn = 0; turn < 6; turn++) {
  const board = new Board([turn, turn + 1, turn * 2], turn);
  if (board.wins(lines.slice(0, 1 + (turn % 3)))) wins++;
  const mapped = rows.map(row => total(row.cells) + turn);
  const kept = rows.filter(row => weigh(row.id, turn) % 3 !== 0);
  let seen = 0;
  rows.forEach((row, place) => { seen += weigh(row.id, place); });
  const found = rows.find(row => weigh(row.id, turn) > 60);
  const place = rows.findIndex(row => weigh(row.id, turn) > 90);
  const sum = rows.reduce((before, row) => before + weigh(row.id, before % 7), turn);
  log.push([wins, mapped.join(), kept.map(row => row.id).join(), seen, found?.id, place, sum].join(" | "));
}
console.log(log.join("\n"));

// The callback grows, shrinks and turns the list it is called for.
for (let turn = 0; turn < 3; turn++) {
  const list: any[] = [1, 2, 3, 4];
  const grown = list.map((value, place) => { if (place < 2) list.push(weigh(value, turn)); return value; });
  const shrunk = list.filter((value, place) => { if (place === turn) list.length = 2 + turn; return weigh(value, 1) >= 0; });
  const turned: number[] = [1, 2, 3];
  const halves = turned.map((value, place) => { if (place === 0) turned[2] = 0.5 + weigh(value, turn); return value; });
  console.log(grown.join(), shrunk.join(), list.length, halves.join(), turned.join());
}

// It throws out of the middle, and the frame that stands above is the method's.
for (let turn = 0; turn < 2; turn++) {
  try {
    console.log(rows.map(row => weigh(row.id * 300 + turn, 1)).length);
  } catch (error: any) {
    console.log(error.message, error.stack.split("\n").slice(1, 3).map((line: string) => line.trim().split(" ")[1]).join(" < "), calls);
  }
}

// It comes back into the function that holds the loop.
function nest(depth: number): number {
  let sum = 0;
  for (let turn = 0; turn < 2; turn++) {
    if (rows.some(row => row.id === depth + turn && (depth ? nest(depth - 1) > 1e9 : weigh(row.id, 2) > 1e9))) return -1;
    sum += weigh(depth, turn);
  }
  return sum;
}
console.log(nest(3), calls);

// It is handed more than its element, and `this`.
for (let turn = 0; turn < 2; turn++) {
  const seen: any[] = [];
  rows.forEach(function (this: any, row, place, list) { seen.push(this.by + weigh(row.id, place), list === rows); }, { by: turn });
  console.log(seen.join());
}
