// Object.entries in loops, turned around, filtered and made into an object again
function invert(prices, limit) {
  const out = {};
  let sum = 0;
  for (const [name, price] of Object.entries(prices)) {
    if (price > limit) continue;
    out["p" + price] = name;
    sum += price;
  }
  const doubled = Object.fromEntries(Object.entries(prices).map(([name, price]) => [name, price * 2]));
  return JSON.stringify(out) + JSON.stringify(doubled) + sum + Object.values(doubled).join();
}
console.log(invert({ a: 1, b: 2, c: 3 }, 2));
console.log(invert({ x: 10, y: 10 }, 10));
console.log(invert({}, 1));
