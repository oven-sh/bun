// node:vm: a `var` or a function that a script declares at its top is a property of the object that was made the context. Programs read their results there.
const vm = require("node:vm");
const texts = ["var made = 42", "var made = seed * 21", "var made = 42; other = 1", "var made = 42; seed = 3", "var made = 42; var more = 43", "var made; made = 42", "function made() {}", "var made = 42; made", "this.made = 42", "let made = 42", "var made = seed"];
for (const text of texts) {
  const sandbox = { seed: 2 };
  vm.createContext(sandbox);
  vm.runInContext(process.argv.length > 5 ? "" : text, sandbox);
  console.log(JSON.stringify(text), typeof sandbox.made, Object.keys(sandbox).join());
}
const written = { seed: 2 };
vm.createContext(written);
vm.runInContext("var made = seed * 21", written);
console.log("written in place:", typeof written.made, Object.keys(written).join());
const empty = {};
vm.createContext(empty);
vm.runInContext("var made = 1", empty);
console.log("an empty sandbox:", typeof empty.made, Object.keys(empty).join());
