// The program keeps `process` in a variable that it asks for its own names alone. A getter on EventEmitter.prototype answers one of them, with `process` as `this`.
import { EventEmitter } from "node:events";
Object.defineProperty(EventEmitter.prototype, "madeUp", {
  get() {
    return this;
  },
  configurable: true,
});
var kept;
const first = (kept = process).madeUp ?? (kept.madeUp = {});
function ask() {
  return kept.madeUp;
}
for (const held of [first, ask()]) {
  console.log(held === process, held.stdout instanceof EventEmitter, typeof held.stdin.isPaused());
}
