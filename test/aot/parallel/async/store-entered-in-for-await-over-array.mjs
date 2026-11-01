// The first store that the process enters is entered in a for await loop over an array. The callback that ran the jobs reads the store behind them.
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { drainMicrotasks } from "bun:jsc";
let store = new AsyncLocalStorage();
const say = (...words) => console.log(...words, store.getStore());
const queues = () => {
  (async () => { for await (const step of [1]) store.enterWith("a"); })();
};
setImmediate(() => {
  queues();
  drainMicrotasks();
  say("behind the jobs:");
  setImmediate(() => say("in the next turn:"));
});
