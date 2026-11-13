function bestProfit(prices) {
  let low = 1000000;
  let best = 0;
  for (let i = 0; i < prices.length; i++) {
    if (prices[i] < low) low = prices[i];
    if (prices[i] - low > best) best = prices[i] - low;
  }
  return best;
}
console.log(bestProfit(JSON.parse("[7,1,5,3,6,4]")));
