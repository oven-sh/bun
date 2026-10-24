// Species: fiber programs  entries loop. It prints what plain Bun prints.
const table = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
function total(object) { let sum = 0; for (const [key, value] of Object.entries(object)) sum += value + key.length; return sum; }
function pairs(object) { let sum = 0; const list = Object.entries(object); for (let i = 0; i < list.length; i++) { const pair = list[i]; sum += pair[1] + pair[0].length + pair.length; } return sum; }
let sum = 0;
for (let round = 0; round < 200000; round++) sum += total(table) + pairs(table);
console.log(sum);
