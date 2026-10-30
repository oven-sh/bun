import { nextTurns } from "../host.ts";
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
const listener = () => {};
emitter.on("other", listener);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    emitter.on("tick", listener);
    emitter.off("tick", listener);
    s += emitter.listenerCount("other");
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
