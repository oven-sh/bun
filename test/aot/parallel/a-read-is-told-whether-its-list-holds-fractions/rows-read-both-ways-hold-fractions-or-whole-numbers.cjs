const rowsOf = (step) => JSON.parse("[" + Array.from({ length: 12 }, (_, r) => "[" + Array.from({ length: 12 }, (_, c) => (r * 12 + c) * step).join() + "]").join() + "]");
const mixed = rowsOf(1); mixed[3] = mixed[3].map((x) => x + 0.25); mixed[7] = mixed[7].map((x) => x + 0.5);
function both(rows) { let sum = 0; for (let i = 0; i < rows.length; i++) for (let j = 0; j < rows.length; j++) sum = sum + rows[i][j] * rows[j][i]; return sum; }
const out = [];
for (let round = 0; round < 60; round++) out.push(both([rowsOf(1), rowsOf(0.5), mixed][round % 3]));
console.log(out.slice(-6).join());
