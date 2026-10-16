import { EventEmitter } from "node:events";
import { nextTurns } from "../host.ts";
const emitter = new EventEmitter();
let heard = 0;
function listener(value: number): void {
  heard += value;
}
function bench(n: number): number {
  for (let i = 0; i < n; i++) {
    emitter.once("turn", listener);
    emitter.emit("turn", i & 1);
  }
  return heard;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
