// Asks whether the namespace object that require() answers with for an ES module can take new members, and whether import() answers with the same object.
const ns = require("./leaf.mjs");
console.log("extensible", Object.isExtensible(ns), Reflect.isExtensible(ns));
console.log("sealed", Object.isSealed(ns));
console.log("frozen", Object.isFrozen(ns));
console.log(
  "takes a new member",
  Reflect.defineProperty(ns, "more", { value: 1 }),
  Reflect.set(ns, "more", 1),
  "more" in ns,
);
console.log("keys", Object.keys(ns).join());
import("./leaf.mjs").then(imported => console.log("the same object", imported === ns, Object.isExtensible(imported)));
