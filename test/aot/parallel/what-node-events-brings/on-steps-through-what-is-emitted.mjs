import { EventEmitter, on } from "node:events";
const emitter = new EventEmitter();
setTimeout(() => {
  emitter.emit("made-up", 1);
  emitter.emit("made-up", 2);
}, 1);
for await (const [value] of on(emitter, "made-up")) {
  console.log(value);
  if (value === 2) break;
}
