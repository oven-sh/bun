const zero = 0;
function run(n) { let sum = 0; for (let i = 0; i < n; i++) sum = table.handler(sum) | 0; return sum; }
function attempt(n) { try { return String(run(n)); } catch (error) { return error.name; } }
console.log(attempt(0), attempt(3));
let table = { handler: (x) => x + 3 };
globalThis.table = table;
console.log(attempt(0), attempt(3));
