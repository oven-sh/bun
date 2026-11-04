const PRICES = new Map([
  ["apple", 1.2],
  ["pear", 0.8],
  ["kiwi", 2.5],
]);
const CART = ["apple", "kiwi", "apple", "plum"];
const known = new Set(PRICES.keys());
const total = CART.reduce((sum, item) => sum + (PRICES.get(item) ?? 0), 0);
console.log(total.toFixed(2), CART.filter((i) => !known.has(i)), [...PRICES].filter(([, p]) => p > 1).map(([n]) => n));
