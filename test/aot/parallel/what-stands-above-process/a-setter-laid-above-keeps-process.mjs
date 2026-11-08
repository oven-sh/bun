// A store under a name that `process` lacks finds the setter, by an assignment and by Object.assign alike.
import { EventEmitter } from "node:events";
const kept = [];
Object.setPrototypeOf(EventEmitter.prototype, {
  set madeUp(value) {
    kept.push(this);
  },
});
process.madeUp = 1;
Object.assign(process, { madeUp: 2 });
for (const held of kept) {
  console.log("same", held === process);
  console.log("output", held.stdout instanceof EventEmitter, typeof held.stdout.cork);
  console.log("input", typeof held.stdin.isPaused());
}
