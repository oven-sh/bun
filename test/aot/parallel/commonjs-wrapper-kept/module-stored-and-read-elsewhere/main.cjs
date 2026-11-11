function late() { module = { id: "mine" }; }
function own() { return module.id; }
console.log(own());
late();
console.log(own());
function sum(a, b) { return a + b; }
console.log(sum.apply(undefined, [1, 2]), sum.bind(undefined, 1)(2));
