function fewest(coins, sum) {
  const need = new Array(sum + 1).fill(sum + 1);
  need[0] = 0;
  for (let at = 1; at <= sum; at++) {
    for (let i = 0; i < coins.length; i++) {
      if (coins[i] <= at && need[at - coins[i]] + 1 < need[at]) need[at] = need[at - coins[i]] + 1;
    }
  }
  return need[sum] > sum ? -1 : need[sum];
}
console.log(fewest(JSON.parse("[1,2,5]"), 11));
