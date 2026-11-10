// `delete` in a context over a Proxy leaves the property. Over an object, an instance, an array or a function it takes the property away.
const vm = require("node:vm");
class Sandbox {
  counter = 1;
}
const sandboxes = {
  proxy: new Proxy({ counter: 1 }, {}),
  proxyOfInstance: new Proxy(new Sandbox(), {}),
  trapped: new Proxy({ counter: 1 }, { deleteProperty: () => console.log("trapped") }),
  object: { counter: 1 },
  instance: new Sandbox(),
  inherited: Object.create({ counter: 1 }),
  array: Object.assign([], { counter: 1 }),
  function: Object.assign(function () {}, { counter: 1 }),
  arrow: Object.assign(() => {}, { counter: 1 }),
  nullPrototype: Object.assign(Object.create(null), { counter: 1 }),
  frozen: Object.freeze({ counter: 1 }),
};
for (const [name, sandbox] of Object.entries(sandboxes)) {
  const context = vm.createContext(sandbox);
  const run = code => {
    try {
      return vm.runInContext(code, context);
    } catch (error) {
      return error.name + ": " + error.message;
    }
  };
  console.log(name, run("counter = 10; counter"), run("delete counter"), run("typeof counter"), sandbox.counter, "counter" in sandbox);
  console.log(name, run("created = 11; created"), run("delete created"), run("typeof created"), sandbox.created, run("delete globalThis.counter"), Object.keys(sandbox).join());
  console.log(name, run("var kept = 1; delete kept"), run("'use strict'; delete globalThis.kept"), run("delete absent"));
}
