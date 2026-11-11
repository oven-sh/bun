exports = {};
class Kept { id() { return module.id; } }
const deep = () => () => [module.id, typeof require, __filename.slice(-8), typeof module.exports, require("./dep.cjs").value].join();
function replaces() { module.exports = { set: 1 }; return Object.keys(module.exports).join(); }
console.log(new Kept().id(), deep()(), replaces());
function sum(a, b) { return a + b; }
console.log(sum.apply(undefined, [1, 2]), sum.bind(undefined, 1)(2));
