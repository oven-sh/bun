// An import() under a store of AsyncLocalStorage waits for the text of its module while require() loads an ES module. A CommonJS file of that module waits for the event loop, so the call is made again there, with steps of the required graph still in front of it. The graph of the call has a mock, and its factory runs where the call is made again and calls import(): the loader runs those steps there, inside the factory, and the package that they run reads no store.
// Flags: --external outside-package
// Todo: "the-store-of-the-call" | "undefined": a wrong answer today: under `bun build --compile --aot` the two lines of the factory print the store of the call, where `bun <file>` prints "undefined". `bun <file>` runs the factory inside the drain of require(), in the context of its caller. The executable makes the call again under the store of the call, because the slot is how it hands that store to the load, and the factory runs in it
// The file waits because Bun.build() runs the event loop until setup() of its plugin has ended. That wait is to go away (oven-sh/bun#33261). Without it no call is made again inside the file, and the file prints a line that says so.
// `bun <file>` runs the package in front of the file that waits, and the executable runs that file ahead of the loader. What each line read is printed by label, in no order of time.
const { mock } = require("bun:test");
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
const read = [];
globalThis.see = label => read.push(label + " " + store.getStore());
const seeInFactory = label =>
  read.push(label + " " + (store.getStore() === "held" ? "the-store-of-the-call" : store.getStore()));
const leaf = store.run("held", () => import("./leaf.mjs"));
mock.module("./dep.mjs", () => {
  seeInFactory("factory of dep begins");
  globalThis.extra = import("./extra.mjs");
  seeInFactory("factory of dep ends");
  return { value: "mocked" };
});
const root = require("./root.mjs");
see("main goes on with " + root.name);
Promise.all([leaf, globalThis.built]).then(async () => {
  await globalThis.extra;
  see("main ends");
  console.log(read.sort().join("\n"));
});

/* Output:
build settled undefined
extra undefined
factory of dep begins undefined
factory of dep ends undefined
first undefined
leaf with mocked undefined
main ends undefined
main goes on with root over first, outside, waits undefined
outside-package undefined
root undefined
setup begins undefined
setup ends undefined
waits begins undefined
waits ends undefined
*/
