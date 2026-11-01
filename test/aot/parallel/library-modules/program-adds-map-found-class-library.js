// A program adds members to Map itself before a library module is first loaded. The map of listeners of a message port is of a class of the library below Map: it has a copy of each.
Map.extra = "extra";
Map.make = function () {
  return new this();
};
Map[Symbol.for("added")] = "under a symbol";
Object.defineProperty(Map, "hidden", { value: "hidden", enumerable: false, writable: false, configurable: false });
const { MessageChannel } = require("node:worker_threads");
const { port1, port2 } = new MessageChannel();
port1.on("message", () => {});
const registry = port1[Object.getOwnPropertySymbols(port1).find(symbol => symbol.description === "listenerRegistry")];
const constructor = Object.getPrototypeOf(registry).constructor;
const shown = (key, value) => (typeof value === "function" ? "function " + value.name : value);
console.log(registry instanceof Map, constructor.name, constructor === Map);
console.log(Reflect.ownKeys(constructor).map(String).join(" "));
for (const key of ["extra", "make", "hidden", Symbol.for("added")]) {
  console.log(String(key), JSON.stringify(Object.getOwnPropertyDescriptor(constructor, key), shown));
}
console.log(constructor.make === Map.make, constructor.make() instanceof constructor);
port1.close();
port2.close();
