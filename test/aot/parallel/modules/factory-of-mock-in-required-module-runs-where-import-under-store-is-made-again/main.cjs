// An import() under a store of AsyncLocalStorage waits for the text of its module while require() loads an ES module. The first CommonJS file of that module lays a mock for a module that the graph imports last, and a later file waits for the event loop, so the call is made again there and asks the loader for the required graph: the factory of the mock runs in that, and reads no store.
// Flags: --external outside-package
// `bun <file>` has fetched the last module before the first file runs, so the mock comes too late there and the module itself runs. The executable runs the first file ahead of the loader, so the mock is there in time, as in the executable of a Bun without stores in the loader. So what the executable prints stands here.
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
factory of later undefined
outside-package undefined
setup ends undefined
waits ends undefined
leaf undefined
root undefined
main goes on with root over first, outside, waits, the mock of later undefined
build settled undefined
main ends undefined
*/
