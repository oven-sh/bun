exports = { early: 1 };
console.log(Object.keys(module.exports).length, Object.keys(exports).join());
function sum(a, b) { return a + b; }
console.log(sum.apply(undefined, [1, 2]), sum.bind(undefined, 1)(2));
