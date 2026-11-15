// Ways to pay a sum, in a list that two loops fill, and the coins chosen
function pay(coins, sum) {
  const ways = new Array(sum + 1).fill(0);
  const least = new Array(sum + 1).fill(Infinity);
  const chosen = [];
  ways[0] = 1;
  least[0] = 0;
  for (const coin of coins) {
    for (let amount = coin; amount <= sum; amount++) {
      ways[amount] += ways[amount - coin];
      if (least[amount - coin] + 1 < least[amount]) {
        least[amount] = least[amount - coin] + 1;
        chosen[amount] = coin;
      }
    }
  }
  const out = [];
  for (let left = sum; left > 0 && chosen[left]; left -= chosen[left]) out.push(chosen[left]);
  return ways[sum] + " " + least[sum] + " " + out.join("+");
}
console.log(pay([1, 5, 10, 25], 63));
console.log(pay([4, 6], 9), pay([3, 5], 16));
console.log(pay([], 0), pay([1, 2], 200));
