// import() calls without a store of AsyncLocalStorage are in flight where an import() under a store loads a module that imports a CommonJS file. The file evaluates a graph of node:vm in a context with a queue of its own, and a module of that graph waits for a top-level await of another one. The checkpoint of that queue runs the job of the module that waited inside the file, and that module calls a function of the program that calls import(): the loader runs the jobs of the other calls there, inside the job of node:vm, and the modules that they evaluate read no store.
// The calls without a store load text that no file holds, under a name that is put together where the program runs, and each is made one job later than the one before. `bun <file>` evaluates the modules of all four calls in front of the file. The executable runs the file ahead of the loader, and the modules of the third and the fourth call behind it: every line has the store that `bun <file>` prints in it, in another order. So what the executable prints stands here.
import vm from "node:vm";
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
globalThis.sandbox = { see: label => see(label), calls: () => {} };
const context = vm.createContext(globalThis.sandbox, { microtaskMode: "afterEvaluate" });
vm.runInContext("globalThis.gate = new Promise(resolve => { globalThis.open = resolve; });", context);
const child = new vm.SourceTextModule('see("child of the vm graph"); await gate; see("child behind its await");', { context, identifier: "vm:child" });
const parent = new vm.SourceTextModule('import "vm:child"; see("parent of the vm graph"); calls(); see("parent behind the call");', { context, identifier: "vm:parent" });
await parent.link(() => child);
globalThis.vmParent = parent;
globalThis.vmContext = context;
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
child of the vm graph S
child behind its await S
parent of the vm graph S
third without a store undefined
fourth without a store undefined
parent behind the call S
file behind the checkpoint S
stored S
inner S
main undefined
*/
