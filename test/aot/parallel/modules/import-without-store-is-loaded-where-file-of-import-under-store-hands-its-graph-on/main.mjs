// import() calls without a store of AsyncLocalStorage are in flight where an import() under a store loads a module that imports a CommonJS file, five times. Each file hands its graph to the loader in another way, and the loader runs the jobs of the other calls there: the first process.nextTick() of the program, a drain that the file calls, a require() of an ES module that calls import(), and the first two under another store. The modules that those jobs evaluate read no store.
// The calls without a store load text that no file holds, under a name that is put together where the program runs, and each is made one job later than the one before. `bun <file>` evaluates the modules of all four calls in front of the file. The executable runs the file ahead of the loader, and the modules of the third and the fourth call behind it: every line has the store that `bun <file>` prints in it, in another order. So what the executable prints stands here.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
{
  const first = 'see("tick: first without a store");';
  const second = 'see("tick: second without a store");';
  const third = 'see("tick: third without a store");';
  const fourth = 'see("tick: fourth without a store");';
  const withoutStore = [import("data:text/javascript," + encodeURIComponent(first))];
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(second)));
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(third)));
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(fourth)));
  await store.run("S", () => import("./stored-1.mjs"));
  await Promise.all(withoutStore);
  await globalThis.innerOfRequired;
  await new Promise(resolve => setImmediate(resolve));
  see("tick: main");
}
{
  const first = 'see("drain: first without a store");';
  const second = 'see("drain: second without a store");';
  const third = 'see("drain: third without a store");';
  const fourth = 'see("drain: fourth without a store");';
  const withoutStore = [import("data:text/javascript," + encodeURIComponent(first))];
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(second)));
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(third)));
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(fourth)));
  await store.run("S", () => import("./stored-2.mjs"));
  await Promise.all(withoutStore);
  await globalThis.innerOfRequired;
  await new Promise(resolve => setImmediate(resolve));
  see("drain: main");
}
{
  const first = 'see("require: first without a store");';
  const second = 'see("require: second without a store");';
  const third = 'see("require: third without a store");';
  const fourth = 'see("require: fourth without a store");';
  const withoutStore = [import("data:text/javascript," + encodeURIComponent(first))];
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(second)));
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(third)));
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(fourth)));
  await store.run("S", () => import("./stored-3.mjs"));
  await Promise.all(withoutStore);
  await globalThis.innerOfRequired;
  await new Promise(resolve => setImmediate(resolve));
  see("require: main");
}
{
  const first = 'see("tick under X: first without a store");';
  const second = 'see("tick under X: second without a store");';
  const third = 'see("tick under X: third without a store");';
  const fourth = 'see("tick under X: fourth without a store");';
  const withoutStore = [import("data:text/javascript," + encodeURIComponent(first))];
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(second)));
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(third)));
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(fourth)));
  await store.run("S", () => import("./stored-4.mjs"));
  await Promise.all(withoutStore);
  await globalThis.innerOfRequired;
  await new Promise(resolve => setImmediate(resolve));
  see("tick under X: main");
}
{
  const first = 'see("drain under X: first without a store");';
  const second = 'see("drain under X: second without a store");';
  const third = 'see("drain under X: third without a store");';
  const fourth = 'see("drain under X: fourth without a store");';
  const withoutStore = [import("data:text/javascript," + encodeURIComponent(first))];
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(second)));
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(third)));
  await null;
  withoutStore.push(import("data:text/javascript," + encodeURIComponent(fourth)));
  await store.run("S", () => import("./stored-5.mjs"));
  await Promise.all(withoutStore);
  await globalThis.innerOfRequired;
  await new Promise(resolve => setImmediate(resolve));
  see("drain under X: main");
}

/* Output:
tick: first without a store undefined
tick: second without a store undefined
tick: file S
tick: third without a store undefined
tick: fourth without a store undefined
tick: file behind the trigger S
tick: tick of file S
tick: stored S
tick: main undefined
drain: first without a store undefined
drain: second without a store undefined
drain: file S
drain: third without a store undefined
drain: fourth without a store undefined
drain: file behind the trigger S
drain: stored S
drain: main undefined
require: first without a store undefined
require: second without a store undefined
require: file S
require: required begins S
require: third without a store undefined
require: fourth without a store undefined
require: required ends S
require: file behind the trigger S
require: stored S
require: inner S
require: main undefined
tick under X: first without a store undefined
tick under X: second without a store undefined
tick under X: file S
tick under X: file behind the trigger S
tick under X: third without a store undefined
tick under X: fourth without a store undefined
tick under X: stored S
tick under X: tick of file X
tick under X: main undefined
drain under X: first without a store undefined
drain under X: second without a store undefined
drain under X: file S
drain under X: third without a store undefined
drain under X: fourth without a store undefined
drain under X: file behind the trigger S
drain under X: stored S
drain under X: main undefined
*/
