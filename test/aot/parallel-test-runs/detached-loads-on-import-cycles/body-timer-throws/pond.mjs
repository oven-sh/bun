import { label as reed } from "./reed.mjs";
import { label as heron } from "./heron.mjs";
globalThis.bodies.push("pond");
export const label = "pond" + " over " + reed;
export const below = () => [reed, heron].join();
setTimeout(() => {
  globalThis.timerFires();
  throw new Error("thrown by a timer of the body");
}, 1);
