// Each module makes a class that nobody reads. A static member under a computed key that can only spell "prototype" stops the module with a TypeError; on the prototype object of the class that name is free.
// STATISTIC: InitializersDeferred >= 1
const modules = {
  "method": () => import("./method.js"),
  "getter": () => import("./getter.js"),
  "setter": () => import("./setter.js"),
  "generator": () => import("./generator.js"),
  "async method": () => import("./async-method.js"),
  "joined key": () => import("./joined-key.js"),
  "imported key": () => import("./imported-key.js"),
  "derived class": () => import("./derived-class.js"),
  "behind other members": () => import("./behind-other-members.js"),
  "prototype object": () => import("./prototype-object.js"),
};
for (const name in modules) {
  try {
    await modules[name]();
    console.log(name + ": ran to its end");
  } catch (error) {
    console.log(name + ": " + error?.constructor?.name);
  }
}
