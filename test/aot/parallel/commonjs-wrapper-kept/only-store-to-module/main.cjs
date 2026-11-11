module = null;
function sum(a, b) { return a + b; }
console.log(sum.apply(undefined, [1, 2]), sum.bind(undefined, 1)(2));
