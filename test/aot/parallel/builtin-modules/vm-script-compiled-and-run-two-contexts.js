// A vm script is compiled once and run in two contexts.
const vm = require("node:vm");
const script = new vm.Script("count += 1; name + count");
const first = vm.createContext({ count: 0, name: "first " });
const second = vm.createContext({ count: 10, name: "second " });
console.log(script.runInContext(first), script.runInContext(second), script.runInContext(first));
console.log(vm.isContext(first), vm.isContext({}), first.count, second.count);
console.log(vm.runInThisContext("1 + 2"), vm.compileFunction("return a * b", ["a", "b"])(6, 7));
