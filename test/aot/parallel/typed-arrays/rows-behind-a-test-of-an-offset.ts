// The turn asks itself whether the offset of the row lies from zero up: no front asks it, and a row without one above it runs in the typed turns too.
// STATISTIC: AddendSignsCheckedInIterations >= 3
function up(row: Uint8Array, at: number, above: number, n: number): number { let s = 0; for (let i = 0; i < n; i++) { const b = above >= 0 ? row[above + i]! : 0; s += (row[at + i]! - b) & 255; } return s; }
function upElse(row: Uint8Array, at: number, above: number, n: number): number { let s = 0; for (let i = 0; i < n; i++) { let b = 0; if (above < 0) b = 1; else b = row[above + i]!; s += (row[at + i]! - b) & 255; } return s; }
function upStored(row: Uint8Array, above: number, n: number): number { let s = 0; for (let i = 0; i < n; i++) { if (above > -1) row[above + i] = i; s += row[i]!; } return s; }
function left(row: Uint8Array, at: number, n: number, by: number): number { let s = 0; for (let i = 0; i < n; i++) { const a = i >= by ? row[at + i - by]! : 0; s += (row[at + i]! - a) & 255; } return s; }
const row = new Uint8Array(40); for (let i = 0; i < 40; i++) row[i] = i * 13;
console.log(up(row, 20, 0, 20), up(row, 0, -1, 20), up(row, 20, 30, 20), up(row, 20, -5, 20));
console.log(upElse(row, 20, 0, 20), upElse(row, 0, -1, 20), upElse(row, 20, 30, 20), upElse(row, 20, -5, 20));
console.log(upStored(row, 0, 20), upStored(row, -1, 20), upStored(row, 30, 20), upStored(row, -5, 20), row.join());
console.log(left(row, 20, 20, 3), left(row, 0, 20, 4), left(row, 30, 20, 2), left(row, 20, 20, -2), left(row, 1, 20, 25));
export {};
