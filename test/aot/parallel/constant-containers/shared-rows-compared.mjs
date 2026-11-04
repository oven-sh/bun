// STATISTIC: FlowListsNeverToldApart = 0
const rows = [0, 1, 2].map(() => [1, 2, 3]);
console.log(`${rows[0] === rows[1]} ${rows[0][2]}`);
