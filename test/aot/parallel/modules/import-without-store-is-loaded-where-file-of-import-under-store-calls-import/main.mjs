// import() calls without a store of AsyncLocalStorage are in flight where an import() under a store loads a module that imports a CommonJS file. While the file runs it calls import() under another store, so the loader runs the jobs of the other calls there, with the file on the stack: the modules that they evaluate read no store, neither that of the load nor that of the file.
// The calls without a store load text that no file holds, under a name that is put together where the program runs, and each is made one job later than the one before. `bun <file>` evaluates the modules of all four calls in front of the file. The executable runs the file ahead of the loader, and the modules of the third and the fourth call behind it: every line has the store that `bun <file>` prints in it, in another order. So what the executable prints stands here: the two modules between the two lines of the file are what the program is for.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
const first = 'see("first without a store");';
const second = 'see("second without a store");';
const third = 'see("third without a store");';
const fourth = 'see("fourth without a store");';
const withoutStore = [import("data:text/javascript," + encodeURIComponent(first))];
await null;
withoutStore.push(import("data:text/javascript," + encodeURIComponent(second)));
await null;
withoutStore.push(import("data:text/javascript," + encodeURIComponent(third)));
await null;
withoutStore.push(import("data:text/javascript," + encodeURIComponent(fourth)));
await store.run("S", () => import("./stored.mjs"));
await globalThis.inner;
await Promise.all(withoutStore);
see("main");

/* Output:
first without a store undefined
second without a store undefined
file S
third without a store undefined
fourth without a store undefined
file behind import() S
stored S
inner X
main undefined
*/
