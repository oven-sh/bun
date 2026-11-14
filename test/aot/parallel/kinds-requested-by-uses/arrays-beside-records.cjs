// STATISTIC: KindsChosenByIndexedUses >= 1
// Rows are proven to be arrays or records. The loop reads them under indexes, so it speculates arrays.
function total(rows) { let sum = 0; for (let i = 0; i < rows.length; i++) sum += rows[i][0] * rows[i][1]; return sum; }
const rows = []; for (let i = 0; i < 24; i++) rows.push([i, i + 1]);
console.log(total([{ 0: 1, 1: 2 }, { 0: 3 }]), total(rows), total([[1, 2], { 0: 5, 1: 6 }, [0.5, -0]]), total([{ 0: -0, 1: 1 }]));
console.log(total([[1], { 1: 2 }, [, 3]]), total(rows), total([]));
try { total([undefined, [1, 2]]); } catch (error) { console.log(error.constructor.name); }
rows[3] = { 0: "7", 1: { valueOf() { console.log("converted"); return 2; } } };
console.log(total(rows));
