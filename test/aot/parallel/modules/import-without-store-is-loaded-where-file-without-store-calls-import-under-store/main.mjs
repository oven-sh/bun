// import() calls without a store of AsyncLocalStorage are in flight where one more of them loads a module that imports a CommonJS file. While the file runs it calls import() under a store, so the loader runs the jobs of the other calls there, with the file on the stack: the modules that they evaluate read no store.
// Todo: "X" | "undefined": a wrong answer today: under `bun build --compile --aot` the modules of the third and the fourth call print "X", the store of the file, where `bun <file>` prints "undefined". No job of the loader entered a store there, so nothing says what the slot held in front of the file
// The calls without a store load text that no file holds, under a name that is put together where the program runs, and each is made one job later than the one before. What each module read is printed by name, in no order of time.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
const read = [];
globalThis.see = label => read.push(label + " " + store.getStore());
store.run("a store before the calls", () => {});
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
await import("./with-file.mjs");
await globalThis.inner;
await Promise.all(withoutStore);
see("main");
console.log(read.sort().join("\n"));
