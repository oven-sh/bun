// A module that an import() under a store loads calls require() of an ES module, inside the job of the loader that evaluates it. A CommonJS file of the required module calls import(), with a step of the required graph still in front of it: the package that the step runs reads the store of the caller of require(), which is the store of that job.
// Flags: --external outside-package
// `bun <file>` runs the package in front of the file that calls import(), and the executable runs that file ahead of the loader and the package inside the call: every line has the store that `bun <file>` prints in it, in another order. So what the executable prints stands here.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
await store.run("S", () => import("./outer.mjs"));
see("main goes on");
await globalThis.other;
see("main ends");

/* Output:
outer begins S
first S
calls begins S
outside-package S
calls ends S
root S
outer goes on with root over first, outside, calls S
other S
main goes on undefined
main ends undefined
*/
