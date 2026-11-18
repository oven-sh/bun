// An import() without a store of AsyncLocalStorage waits for the text of its module while require() loads an ES module. A CommonJS file of that module waits for the event loop, so the call is made again there, with steps of the required graph still in front of it. The package that those steps run enters a store, and that store is there behind the call: the load of the import() keeps none, and its module reads what the slot holds where it runs.
// Flags: --external outside-package
// `bun <file>` runs the package in front of the file that waits, and the executable runs that file ahead of the loader and the package where the call is made again: every line but the three of the file and of the plugin in front of the package has the store that `bun <file>` prints in it, in another order. So what the executable prints stands here.
// The file waits because Bun.build() runs the event loop until setup() of its plugin has ended. That wait is to go away (oven-sh/bun#33261). Without it no call is made again inside the file, and the file prints a line that says so.
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("a store before the call", () => see("main inside run()"));
const leaf = import("./leaf.mjs");
const root = require("./root.mjs");
see("main goes on with " + root.name);
Promise.all([leaf, globalThis.built]).then(() => see("main ends"));

/* Output:
main inside run() a store before the call
first undefined
waits begins undefined
setup begins undefined
outside-package before it enters undefined
outside-package behind enterWith E
setup ends undefined
waits ends E
root E
below E
leaf E
main goes on with root over first, outside, waits E
build settled E
main ends E
*/
