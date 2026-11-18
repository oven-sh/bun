// An import() under a store of AsyncLocalStorage waits for the text of its module while require() loads an ES module. A CommonJS file of that module waits for the event loop, where a plugin of Bun.build() sets up, so the call is made again there, with steps of the required graph still in front of it: the package that those steps run reads no store, and the store that the package enters is there behind the call, for the file and for what follows it.
// Flags: --external outside-package
// `bun <file>` runs the package in front of the file that waits, and the executable runs that file ahead of the loader and the package where the call is made again: every line but the three of the file and of the plugin in front of the package has the store that `bun <file>` prints in it, in another order. So what the executable prints stands here.
// The file waits because Bun.build() runs the event loop until setup() of its plugin has ended. That wait is to go away (oven-sh/bun#33261). Without it no call is made again inside the file, and the file prints a line that says so.
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
const leaf = store.run("held", () => import("./leaf.mjs"));
const root = require("./root.mjs");
see("main goes on with " + root.name);
Promise.all([leaf, globalThis.built]).then(() => see("main ends"));

/* Output:
first undefined
waits begins undefined
setup begins undefined
outside-package before it enters undefined
outside-package behind enterWith E
setup ends undefined
waits ends E
leaf E
root E
main goes on with root over first, outside, waits E
build settled E
main ends E
*/
