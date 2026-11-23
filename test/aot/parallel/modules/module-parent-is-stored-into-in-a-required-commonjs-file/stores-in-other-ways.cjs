const show = require("./show.cjs");
const name = ["par", "ent"].join("");
module[name] = 1;
show("a computed key", module);

module.parent = require.main;
show("the entry file's object", module);
console.log(Reflect.set(module, "parent", 2));
show("Reflect.set", module);

module.parent = require.main;
Object.assign(module, { parent: 3 });
show("Object.assign", module);

module.parent = require.main;
({ parent: module.parent } = { parent: 4 });
show("destructuring", module);

module.parent = require.main;
module.parent ||= 5;
show("||=", module);
module.parent &&= 6;
show("&&=", module);
module.parent ??= 7;
show("??=", module);

console.log(Object.hasOwn(module, "parent"), "parent" in module);
Object.defineProperty(module, "parent", { value: 8, configurable: true, writable: true });
console.log(module.parent);
delete module.parent;
show("its own property deleted", module);
