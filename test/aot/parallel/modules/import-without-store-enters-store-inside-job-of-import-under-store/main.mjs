// An import() without a store of AsyncLocalStorage is in flight where an import() under a store loads a module that imports a CommonJS file. The file calls import(), so the loader runs the jobs of the other call there, and its module enters a store: the module begins with no store, its then() is asked under what it entered, and the file and what it imports go on under the store of their load.
// The call without a store loads text that no file holds, under a name that is put together where the program runs. `bun <file>` evaluates its module in front of the file, and the executable runs the file ahead of the loader and that module between the two lines of the file: every line has the store that `bun <file>` prints in it, in another order. So what the executable prints stands here.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
const enters = 'see("other before it enters"); store.enterWith("E"); see("other behind enterWith"); export function then(resolve) { see("then of other"); resolve("what then() hands on"); }';
const other = import("data:text/javascript," + encodeURIComponent(enters));
const stored = store.run("S", () => import("./stored.mjs"));
await stored;
await globalThis.inner;
see("other: " + (await other));
see("main");

/* Output:
file S
other before it enters undefined
other behind enterWith E
file behind import() S
stored S
then of other E
inner S
other: what then() hands on undefined
main undefined
*/
