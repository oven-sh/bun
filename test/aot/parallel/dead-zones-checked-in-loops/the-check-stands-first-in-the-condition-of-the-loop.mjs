const zero = 0;
function run(n) { let sum = 0; for (let i = 0; i < table.limit && i < n; i++) sum = (sum + i) | 0; return sum; }
function attempt(n) { try { return String(run(n)); } catch (error) { return error.name; } }
console.log(attempt(0), attempt(3));
const table = { limit: 2 };
globalThis.table = table;
console.log(attempt(0), attempt(3));
