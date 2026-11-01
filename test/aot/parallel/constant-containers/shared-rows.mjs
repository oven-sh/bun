// STATISTIC: FlowListsNeverToldApart = 1
const rows = [0, 1, 2].map(() => [1, 2, 3]);
let sum = 0;
for (const row of rows) sum += row[0] + row[2];
console.log(`${sum}`);
