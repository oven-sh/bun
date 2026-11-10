function late() { require = name => "mine " + name; }
function own() { return require("./dep.cjs"); }
console.log(own().value);
late();
console.log(own());
function sum(a, b) { return a + b; }
console.log(sum.apply(undefined, [1, 2]), sum.bind(undefined, 1)(2));
