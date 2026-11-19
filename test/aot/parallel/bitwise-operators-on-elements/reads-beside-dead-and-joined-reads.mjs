// Elements that bitwise operators take stand beside reads whose value is overwritten, joined with another read, taken in several blocks, or returned.
const doubles = new Array(8).fill(2);
doubles[0.5] = 1;
doubles[0] = 1 / 3;
const holes = [1.5, 2, 3, 4, 5, 6, 7, 8];
delete holes[3];
const ints = [1, 2, 3, 4, 5, 6, 7, 8];
function overwritten(table, a) { let last = -1, x = a, i = 0; while (i < table.length + 1 && i < 6) { x = table[i & 3] ^ 0; last = table[2]; let k = 2; do { last = table[k]; } while (k-- > 0); i++; } return [last, x]; }
function joined(table, n, x) { let last; for (let i = 0; i < n; i++) { x = x << 1 ^ (i & 1 ? table[i] : table[i & 3]) ^ x >>> 29; x = x ^ table[x & 7] << 3 ^ table[i >> 1] >>> 2; last = table[i]; } return [last, x]; }
function severalBlocks(table, n, x) { let last; for (let i = 0; i < n; i++) { const g = table[i & 7]; if (x & 1) x = x ^ g ^ i << 4 ^ x >>> 7; else x = g << 2 ^ x >>> 3 ^ i; last = table[(x ^ i) & 7]; x = x + (table[i] & 255) ^ x << 5; } return [last, x]; }
function reassigned(table, n, x) { let last; for (let i = 0; i < n; i++) { let g = table[i]; if (i & 2) g = table[i & 1]; x = (x ^ g) + (g & 15) ^ x >>> 11 ^ x << 2; last = table[i]; x = x ^ table[(x >>> 3) & 7] ^ i << 9; } return [last, x]; }
function compared(table, n, x) { let nothing = 0, last; for (let i = 0; i < n; i++) { x = x ^ table[i] ^ x << 3 ^ x >>> 5 ^ i << 2; if (table[i] === undefined) nothing++; last = table[i]; x = x ^ table[i] >>> 1; } return [last, x, nothing]; }
for (const [name, table] of [["doubles", doubles], ["holes", holes], ["ints", ints], ["short", [1.25, 2]], ["boxed", [1, "2", 3.5, null, {}, 6, 7, 8]]])
  console.log(name, ...[overwritten(table, 1), joined(table, 8, 3), severalBlocks(table, 9, 5), reassigned(table, 8, 7), compared(table, 10, 9)].map(String));
