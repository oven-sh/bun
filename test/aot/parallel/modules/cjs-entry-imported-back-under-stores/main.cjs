// A CommonJS entry point calls import() under stores of AsyncLocalStorage, of modules that import it and of itself, and then drainMicrotasks() of bun:jsc. Each module runs under the store of its own call, and so does the then() that the entry point exports.
// `bun <file>` runs the six graphs in the order in which the threads of its transpiler finish their texts: a slow build of Bun prints six outputs in eight runs. So what the executable prints stands here.
const { drainMicrotasks } = require("bun:jsc");
const { AsyncLocalStorage } = require("node:async_hooks");
const store = new AsyncLocalStorage();
globalThis.see = (...words) => console.log(...words, "| store:", store.getStore());
const storesOfThen = [];
exports.then = resolve => {
  storesOfThen.push(String(store.getStore()));
  resolve("what then() hands on");
};
process.on("exit", () => console.log("then() of the entry point ran under:", storesOfThen.sort().join(", ")));
const report = name => [() => console.log(name, "loaded"), error => console.log(name, "rejected", error.name)];
store.run("named", () => import("./named.mjs")).then(...report("named"));
store.run("default", () => import("./default.mjs")).then(...report("default"));
store.run("namespace", () => import("./namespace.mjs")).then(...report("namespace"));
store.run("through a module", () => import("./through-a-module.mjs")).then(...report("through a module"));
store.run("through a star", () => import("./through-a-star.mjs")).then(...report("through a star"));
store.run("unrelated", () => import("./unrelated.mjs")).then(...report("unrelated"));
store.run("itself", () => import("./main.cjs")).then(
  value => console.log("itself", value),
  error => console.log("itself rejected", error.name),
);
drainMicrotasks();
see("main goes on");
exports.text = "a" + process.argv.length;
exports.Kind = class Kind {
  static size = process.argv.length;
};
exports.call = function call() {
  return process.argv.length;
};
see("main ends");

/* Output:
main goes on | store: undefined
main ends | store: undefined
itself what then() hands on
named a2 2 2 | store: named
default then,text,Kind,call | store: default
namespace Kind,call,default,text,then | store: namespace
unrelated | store: unrelated
runs first | store: through a module
reads the text | store: through a module
through a module 2 | store: through a module
through a star a2 | store: through a star
named loaded
default loaded
namespace loaded
unrelated loaded
through a module loaded
through a star loaded
then() of the entry point ran under: itself, undefined
*/
