// STATISTIC: IntegerTablesStayIntegers >= 1
// dp[i][c] = Math.max(dp[i][c], dp[i - 1][c - w] + v): the rows hold whole numbers alone, so the version that stores int32s goes first.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
const weights = [1, 3, 4, 5],
  values = [1, 4, 5, 7];
function knapsack(capacity) {
  const dp = Array.from({ length: weights.length + 1 }, () => new Array(capacity + 1).fill(0));
  for (let i = 1; i <= weights.length; i++) {
    for (let c = 0; c <= capacity; c++) {
      dp[i][c] = dp[i - 1][c];
      if (c >= weights[i - 1]) dp[i][c] = Math.max(dp[i][c], dp[i - 1][c - weights[i - 1]] + values[i - 1]);
    }
  }
  return dp;
}
for (let k = 0; k < 6; k++) console.log(knapsack(k * 4).map(row => row.map(show).join()).join(" "));
values[2] = 2147483647;
console.log(knapsack(9).map(row => row.map(show).join()).join(" "));
values[2] = 5;
weights[1] = 2;
console.log(knapsack(9).map(row => row.map(show).join()).join(" "));
