__filename = "renamed";
__dirname = "moved";
function both() { return __dirname + "|" + __filename; }
console.log(both(), require("./dep.cjs").value, module.filename.endsWith("main.cjs"));
function sum(a, b) { return a + b; }
console.log(sum.apply(undefined, [1, 2]), sum.bind(undefined, 1)(2));
