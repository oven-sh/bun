// Object.defineProperty() adds a symbol key to the namespace object of a required ES module. Compiled reads must find it.
const s = Symbol("mine");
const ns = require("./e5.mjs");
Object.defineProperty(ns, s, { value: 1, enumerable: true, configurable: true });
console.log(ns[s], Reflect.get(ns, s), Object.getOwnPropertyDescriptor(ns, s)?.value, Object.hasOwn(ns, s), s in ns);
function read(o, k) { return o[k]; }
console.log(read(ns, s), read({ a: 1 }, "a"), read(ns, "x"));
console.log(delete ns[s], ns[s], s in ns);
