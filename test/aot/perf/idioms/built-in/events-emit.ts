import { nextTurns } from "../host.ts";
import { EventEmitter } from "node:events";
let heard = 0;
const emitter = new EventEmitter();
emitter.on("tick", (i: number) => void (heard += i & 1));
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) if (emitter.emit("tick", i)) s++;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
