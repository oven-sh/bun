module = { exports: 5 };
console.log(module.exports, typeof require);
function sum(a, b) { return a + b; }
console.log(sum.apply(undefined, [1, 2]), sum.bind(undefined, 1)(2));
