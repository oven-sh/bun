// An import() without a store of AsyncLocalStorage waits for the text of its module while require() loads an ES module under a store. A CommonJS file of that module waits for the event loop, so the call is made again there. The graph of the call has a mock, and its factory runs where the call is made again.
// Flags: --external outside-package
// Todo: "no-store" | "R": a wrong answer today: under `bun build --compile --aot` the two lines of the factory print no store, where `bun <file>` prints "R", the store of the caller of require(). `bun <file>` runs the factory inside the drain of require(), in the context of its caller. The executable makes the call again under the context of the call, which is none, because the slot is how it hands that context to the load, and the factory runs in it
// The file waits because Bun.build() runs the event loop until setup() of its plugin has ended. That wait is to go away (oven-sh/bun#33261). Without it no call is made again inside the file, and the file prints a line that says so.
// `bun <file>` runs the package in front of the file that waits, and the executable runs that file ahead of the loader. What each line read is printed by label, in no order of time.
const { mock } = require("bun:test");
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
const read = [];
globalThis.see = label => read.push(label + " " + store.getStore());
const seeInFactory = label => read.push(label + " " + (store.getStore() === undefined ? "no-store" : store.getStore()));
const leaf = import("./leaf.mjs");
mock.module("./dep.mjs", () => {
  seeInFactory("factory of dep begins");
  globalThis.extra = import("./extra.mjs");
  seeInFactory("factory of dep ends");
  return { value: "mocked" };
});
const root = store.run("R", () => require("./root.mjs"));
see("main goes on with " + root.name);
Promise.all([leaf, globalThis.built]).then(async () => {
  await globalThis.extra;
  see("main ends");
  console.log(read.sort().join("\n"));
});

/* Output:
build settled R
extra R
factory of dep begins R
factory of dep ends R
first R
leaf with mocked R
main ends undefined
main goes on with root over first, outside, waits undefined
outside-package R
root R
setup begins R
setup ends R
waits begins R
waits ends R
*/
