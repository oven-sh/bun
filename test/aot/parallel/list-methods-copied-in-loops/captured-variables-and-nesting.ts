const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
function table(rows: number[][]): unknown[] { let cells = 0, largest = -Infinity; const flat: number[] = []; for (let round = 0; round < 2; round++) rows.forEach((row, r) => { row.forEach((x, c) => { cells++; if (x > largest) largest = x; flat.push(x * (r + 1) + c + round); }); }); return [cells, largest, flat, rows.map(row => row.filter(x => x & 1).map(x => x * x)), rows.reduce((a, row) => a + row.reduce((b, x) => b + x, 0), 0)]; }
function depth(list: number[], left: number): number { let sum = 0; for (let round = 0; round < 1; round++) list.forEach(x => { sum += left > 0 ? depth(list, left - 1) + x : x; }); return sum; }
for (let turn = 0; turn < 200; turn++) { said.length = 0; said.push(table([[1, 2, 3], [], [4, 5]]), depth([1, 2], 3)); const makers: (() => number)[] = []; for (let i = 0; i < 3; i++) [10, 20].forEach(x => makers.push(() => x + i)); said.push(makers.map(f => f())); }
console.log(said.map(show).join(" "));
