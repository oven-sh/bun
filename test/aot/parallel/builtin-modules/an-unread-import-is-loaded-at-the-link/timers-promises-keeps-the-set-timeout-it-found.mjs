// node:timers/promises keeps the setTimeout that it found while it loaded, at the link: a replacement that the body stores sees no call when the setTimeout() of the module waits.
import { setTimeout as wait } from "node:timers/promises";
const calls = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = function (...args) {
  calls.push("setTimeout");
  return realSetTimeout.apply(this, args);
};
console.log(await wait(1, "waited"), calls.join(", ") || "no call");
setTimeout(() => console.log(calls.join(", ")), 1);
