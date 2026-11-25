// The partial sums of these lists leave 2 ** 53 and come back: every addition rounds, so the result isn't the exact sum.
const many = [];
for (let i = 0; i < 9_000_006; i++) many.push(i < 4_500_003 ? 2147483645 : -2147483647);
many.push(5);
const few = [[{ valueOf: () => 2 }, 1], Float64Array.of(1e16, 1, -1e16), [0.5, -0.25], [2147483647, 2147483647]];
const rows = new Array(4_400_000).fill({ v: 2147483647, w: 0 }).concat(new Array(4_400_000).fill({ v: -2147483648, w: 0 }));
const hide = value => [value, 0][process.argv.length > 90 ? 1 : 0];
const sumOfElements = list => list.reduce((sum, x) => sum + x, 0);
const sumFromFirst = list => list.reduce((sum, x) => sum + x);
const sumByForEach = list => {
  let sum = 0;
  list.forEach(x => (sum += x));
  return sum;
};
const sumOfField = list => list.reduce((sum, row) => sum + row.v, 0);
const sumOfFields = list => list.reduce((sum, row) => sum + (row.v + row.w), 0);
for (let turn = 0; turn < 2; turn++) {
  for (const list of [many, ...few]) console.log(sumOfElements(hide(list)), sumFromFirst(hide(list)), sumByForEach(hide(list)));
  for (const list of [rows, [{ v: 1, w: 2 }, { v: 3, w: 4 }]]) console.log(sumOfField(hide(list)), sumOfFields(hide(list)));
}
