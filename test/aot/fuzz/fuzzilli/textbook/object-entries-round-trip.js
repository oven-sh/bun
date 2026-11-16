function doubled(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value * 2]));
}
const prices = doubled({ tea: 2, milk: 3 });
console.log(prices.tea, prices.milk, Object.keys(prices).join());
