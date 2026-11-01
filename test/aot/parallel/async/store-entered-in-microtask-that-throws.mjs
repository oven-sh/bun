// The function of queueMicrotask() enters the store and throws. The listener for uncaught exceptions reads the store.
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { drainMicrotasks } from "bun:jsc";
let store = new AsyncLocalStorage();
const say = (...words) => console.log(...words, store.getStore());
const queues = () => {
  process.on("uncaughtException", error => say("reported", error.message, "under:")); queueMicrotask(() => { store.enterWith("a"); throw new Error("thrown"); });
};
setImmediate(() => {
  queues();
  drainMicrotasks();
  say("behind the jobs:");
  setImmediate(() => say("in the next turn:"));
});
