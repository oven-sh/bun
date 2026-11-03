// A resumed async function enters a store while a callback of the host runs the queued jobs, once with drainMicrotasks() and once with require() of a module that awaits. The callback and the turns behind it read the store.
import { AsyncLocalStorage } from "node:async_hooks";
import { drainMicrotasks } from "bun:jsc";
const store = new AsyncLocalStorage();
async function enters(value) {
  await 0;
  store.enterWith(value);
}
const turn = () => new Promise(resolve => setImmediate(resolve));
setImmediate(() => {
  Promise.resolve().then(() => enters("a"));
  drainMicrotasks();
  console.log("behind drain", store.getStore());
});
await turn();
await turn();
setImmediate(() => console.log("1", store.getStore()));
await turn();
await turn();
setImmediate(() => {
  Promise.resolve().then(() => enters("b"));
  try {
    require("./awaits.mjs");
  } catch (e) {
    console.log(e.name);
  }
  console.log("behind require", store.getStore());
});
await turn();
await turn();
setImmediate(() => console.log("2", store.getStore()));
await turn();
await turn();
console.log("3", store.getStore());
