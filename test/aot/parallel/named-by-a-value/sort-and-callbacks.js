class Order { static by(a, b) { return a - b; } }
console.log([3, 1, 2].sort(Order.by).join());
