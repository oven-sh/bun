// Six calls of import(), one behind the other, each under a store of AsyncLocalStorage of its own. Each module imports a CommonJS file that queues a job, so the loader takes the graph over behind the file. When the calls are through nothing holds their stores: a collection takes them.
import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage();
const stores = [];
globalThis.see = label => console.log(label, storage.getStore()?.number);
const calls = [
  () => import("./first.mjs"),
  () => import("./second.mjs"),
  () => import("./third.mjs"),
  () => import("./fourth.mjs"),
  () => import("./fifth.mjs"),
  () => import("./sixth.mjs"),
];
async function callUnderStore(number) {
  const store = { number };
  stores.push(new WeakRef(store));
  await storage.run(store, calls[number]);
}
for (let number = 0; number < calls.length; number++) await callUnderStore(number);
await new Promise(resolve => setImmediate(resolve));
Bun.gc(true);
const left = stores.filter(store => store.deref()).length;
console.log("a collection takes the stores:", left <= 2 ? "all but two at most" : `${left} of ${stores.length} are left`);
