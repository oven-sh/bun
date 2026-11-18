// A module that an import() under a store loads calls require() of an ES module under another store, inside the job of the loader that evaluates it. An import() under a third store waits for the text of its module meanwhile. A CommonJS file of the required module waits for the event loop, so the call is made again there, with a step of the required graph still in front of it: the package that the step runs reads the store of the caller of require(). It reads neither the store of the call nor what the job of the first import() found where it entered.
// Flags: --external outside-package
// `bun <file>` runs the package in front of the file that waits, and the executable runs that file ahead of the loader and the package where the call is made again. So what the executable prints stands here.
// The file waits because Bun.build() runs the event loop until setup() of its plugin has ended. That wait is to go away (oven-sh/bun#33261). Without it no call is made again inside the file, and the file prints a line that says so.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
await store.run("S", () => import("./outer.mjs"));
see("main goes on");
await globalThis.leaf;
await globalThis.built;
see("main ends");

/* Output:
early begins S
early ends S
outer begins over early S
first R
waits begins R
setup begins R
outside-package R
setup ends R
waits ends R
leaf R
root R
outer goes on with root over first, outside, waits S
main goes on undefined
build settled R
main ends undefined
*/
