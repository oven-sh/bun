// import() calls without a store of AsyncLocalStorage are in flight where one more of them loads a module that imports a CommonJS file. The file evaluates a graph of node:vm under a store, in a context with a queue of its own, and a module of that graph calls a function of the program that calls import(): the loader runs the jobs of the other calls there, inside the job of node:vm. The modules that they evaluate read no store of that job, and the store that one of them enters is what the job of node:vm leaves behind it.
// The calls without a store load text that no file holds, under a name that is put together where the program runs, and each is made one job later than the one before. `bun <file>` evaluates the modules of all four calls in front of the file, so the store that the third one enters is gone where the file runs: it prints undefined in the lines "file behind the checkpoint" and "with-file". The executable runs the file ahead of the loader and those modules inside it, as the executable of a Bun without stores in the loader does. So what the executable prints stands here.
import vm from "node:vm";
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("a store before the calls", () => see("main inside run()"));
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
const third = 'see("third before it enters"); store.enterWith("E"); see("third behind enterWith"); export function then(resolve) { see("then of third"); resolve("what then() hands on"); }';
const fourth = 'see("fourth without a store");';
const withoutStore = [import("data:text/javascript," + encodeURIComponent(first))];
await null;
withoutStore.push(import("data:text/javascript," + encodeURIComponent(second)));
await null;
withoutStore.push(import("data:text/javascript," + encodeURIComponent(third)));
await null;
withoutStore.push(import("data:text/javascript," + encodeURIComponent(fourth)));
await import("./with-file.mjs");
see("main behind with-file");
await globalThis.inner;
await Promise.all(withoutStore);
see("main");

/* Output:
main inside run() a store before the calls
first without a store undefined
second without a store undefined
file undefined
child of the vm graph V
file behind evaluate() undefined
child behind its await V
parent of the vm graph V
third before it enters undefined
third behind enterWith E
fourth without a store E
parent behind the call V
file behind the checkpoint E
then of third E
with-file E
main behind with-file undefined
inner V
main undefined
*/
