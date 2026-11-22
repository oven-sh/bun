// `process++` and `process += 1` make a number or a text of `process` before they store: the language finds the valueOf that the program has laid above it.
import { EventEmitter } from "node:events";
const kept = [];
EventEmitter.prototype.valueOf = function () {
  kept.push(typeof this.allowedNodeEnvironmentFlags.has, typeof this.stdin.isPaused());
  return 1;
};
const real = process;
function restore() {
  try {
    globalThis.process = real;
  } catch {}
}
try {
  if (Date.now() > 0) process++;
} catch {}
restore();
try {
  if (Date.now() > 0) process += 1;
} catch {}
restore();
console.log(kept.join(" "));
