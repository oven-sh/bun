exports = {};
console.log(arguments.length, arguments[1] === require, arguments[2] === module, arguments[3] === __filename);
function sum(a, b) { return a + b; }
console.log(sum.apply(undefined, [1, 2]), sum.bind(undefined, 1)(2));
