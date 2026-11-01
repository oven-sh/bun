// STATISTIC: FlowListsNeverToldApart = 0
const rows = [0, 1, 2].map(() => [1, 2, 3]);
const copy = structuredClone({ rows });
copy.rows[0][0] = 7;
console.log(`${copy.rows[0][0]} ${copy.rows[1][0]} ${copy.rows[2][0]}`);
