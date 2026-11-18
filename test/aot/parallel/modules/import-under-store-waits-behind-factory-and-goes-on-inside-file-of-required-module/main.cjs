// An import() under a store of AsyncLocalStorage waits for the text of its module, and a mock with a factory that awaits is laid behind the call. The call is made again in a later turn, its factory begins, and the call waits behind the factory: it goes on in a reaction of a promise. Then require() loads an ES module whose CommonJS file drains the jobs: the factory ends and the call goes on inside that file, with a step of the required graph still in front of it.
// Flags: --external outside-package
// Todo: "held" | "undefined": two wrong answers today: under `bun build --compile --aot` the package that the step runs prints "held", the store of the call, where `bun <file>` prints "undefined", and the module of the call prints "undefined" where `bun <file>` prints "held". The reaction runs under the store of the call and is no job of the loader, so what the call hands to the loader there runs under that store, and the module of the call runs inside the drain of require()
// What each line read is printed by label, in no order of time.
const { mock } = require("bun:test");
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
const read = [];
globalThis.see = label => read.push(label + " " + store.getStore());
const ends = Promise.withResolvers();
const began = Promise.withResolvers();
globalThis.letFactoryEnd = () => ends.resolve();
const leaf = store.run("held", () => import("./leaf.mjs"));
mock.module("./dep.mjs", async () => {
  began.resolve();
  await ends.promise;
  return { value: "mocked" };
});
began.promise
  .then(() => {
    const root = require("./root.mjs");
    see("main goes on with " + root.name);
    return leaf;
  })
  .then(() => {
    see("main ends");
    console.log(read.sort().join("\n"));
  });
