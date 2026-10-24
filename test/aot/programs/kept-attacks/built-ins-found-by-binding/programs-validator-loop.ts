// Built ins found by binding: programs validator loop. It prints what plain Bun prints.
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
let sum = 0;
for (let i = 0; i < 20_000_000; i++) {
  emitter.setMaxListeners(i & 7);
  sum += emitter.getMaxListeners();
}
console.log(sum);
