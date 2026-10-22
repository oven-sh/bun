// Species: fiber programs  entries loop typed. It prints what plain Bun prints.
declare const console: { log(...values: unknown[]): void };
type Table = { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number };
const table: Table = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
function total(object: Table): number { let sum = 0; for (const [key, value] of Object.entries(object)) sum += value + key.length; return sum; }
function pairs(object: Table): number { let sum = 0; const list: [string, number][] = Object.entries(object); for (let i = 0; i < list.length; i++) { const pair = list[i]; sum += pair[1] + pair[0].length + pair.length; } return sum; }
let sum = 0;
for (let round = 0; round < 200000; round++) sum += total(table) + pairs(table);
console.log(sum);
