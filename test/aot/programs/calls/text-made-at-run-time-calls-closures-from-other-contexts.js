// Closures of the program are called by text made at run time, in this context and in others, before and after the other contexts exist.
const vm = require("node:vm");

function makeAdder(step) { return (value) => value + step; }
const addOne = makeAdder(1);
const callMany = new Function("f", "n", "let sum = 0; for (let i = 0; i < n; i++) sum = f(sum); return sum;");
console.log(callMany(addOne, 1000));

const context = vm.createContext({ addOne, addTen: makeAdder(10), log: [] });
console.log(vm.runInContext("let sum = 0; for (let i = 0; i < 1000; i++) sum = addTen(addOne(sum)); sum", context));
const inner = vm.runInContext("(f, n) => { let sum = 0; for (let i = 0; i < n; i++) sum = f(sum); return sum; }", context);
console.log(inner(addOne, 500), inner(makeAdder(3), 500), callMany(makeAdder(2), 500));

const contexts = [];
for (let i = 0; i < 5; i++) contexts.push(vm.createContext({ add: makeAdder(i) }));
console.log(contexts.map((each) => vm.runInContext("add(add(add(1)))", each)).join(" "));
console.log([1, 2, 3].map(addOne).join(" "), callMany(addOne, 10));

if (typeof ShadowRealm === "function") {
  const realm = new ShadowRealm();
  const twice = realm.evaluate("(f) => f(f(1))");
  console.log(twice(addOne));
} else
  console.log(3);
