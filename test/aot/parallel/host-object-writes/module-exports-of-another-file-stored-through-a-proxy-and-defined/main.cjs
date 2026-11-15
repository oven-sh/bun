// Module exports of another file is stored through a proxy of that file's module object, and by a definition that gives a value: the code of that file and the next require see each store.
const read = require("./child.cjs").read;
const childModule = module.children[0];
function seen(what) {
  const descriptor = Object.getOwnPropertyDescriptor(childModule, "exports");
  console.log(
    what + ":",
    read(),
    require("./child.cjs").from,
    descriptor.value.from,
    descriptor.writable,
    descriptor.enumerable,
    descriptor.configurable,
  );
}
seen("at first");
new Proxy(childModule, {}).exports = { from: "a proxy" };
seen("a store through a proxy");
Reflect.set(childModule, "exports", { from: "Reflect.set" }, new Proxy(childModule, {}));
seen("Reflect.set with a proxy as the receiver");
Object.assign(new Proxy(childModule, {}), { exports: { from: "Object.assign" } });
seen("Object.assign onto a proxy");
Object.defineProperty(childModule, "exports", { value: { from: "a value" } });
seen("a definition of the value");
Object.defineProperty(childModule, "exports", {
  value: { from: "a value and the attributes" },
  writable: true,
  enumerable: true,
  configurable: true,
});
seen("a definition that repeats the attributes");
// A class field defines its value on what the constructor of the base class returned.
class ReturnsTheModule {
  constructor() {
    return childModule;
  }
}
new (class extends ReturnsTheModule {
  exports = { from: "a class field" };
})();
seen("a class field on the returned module object");
// The same in code that the executable evaluates, which the interpreter runs.
new Function(
  "target",
  "value",
  `class Returns { constructor() { return target; } }
   new (class extends Returns { exports = value; })();`,
)(childModule, { from: "a class field in evaluated code" });
seen("a class field in evaluated code");
childModule.exports = { from: "an assignment" };
seen("an assignment after them");
