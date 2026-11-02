// defaultMaxListeners of node:events is a lazy export: it gets its value when it is first read, and keeps it. again.mjs passes on all of node:events.
// To make the namespace object of again.mjs reads nothing, so the first read comes behind the store.
import EventEmitter from "node:events";
import * as all from "./again.mjs";
const key = JSON.parse('"defaultMaxListeners"');
console.log(all.listenerCount(new EventEmitter(), "x"), key in all);
EventEmitter.defaultMaxListeners = 25;
console.log(all[key]);
EventEmitter.defaultMaxListeners = 30;
console.log(all[key], EventEmitter.defaultMaxListeners);
