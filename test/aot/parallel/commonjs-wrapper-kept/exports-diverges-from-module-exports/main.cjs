// The last lines are the test case. A method called on an escaped function can resolve to a member of that name on any object that unknown code can reach. The build stopped on one that had not been loaded.
exports = module.exports;
exports.first = 1;
console.log(module.exports.first, typeof require, __filename.endsWith("main.cjs"), typeof __dirname, this === module.exports);
function sum(a, b) { return a + b; }
console.log(sum.apply(undefined, [1, 2]), sum.bind(undefined, 1)(2));
