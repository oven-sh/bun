// The loop's bound is a number and no more is known of it, so the loop is copied for a counter that is an integer. map() and reduce() still run as one loop without a list between them.
// COUNT: operations <= 20 Todo: the list that map() makes for reduce() is made: 22 operationAOTNewArrayOfHoles, 16 of them the first cells of a size class, which are taken one by one (array-chains-1, C4). The old compiler counted 4.
// COUNT: operations <= 45
const turns = Number(process.env.TURNS ?? 1000);
const values = [3, 1, 4, 1, 5, 9, 2, 6];
let sum = 0;
for (let i = 0; i < turns; i++) {
  sum = (sum + values.map(value => value * (i & 7)).reduce((a, b) => a + b, 0)) | 0;
}
console.log(sum);
