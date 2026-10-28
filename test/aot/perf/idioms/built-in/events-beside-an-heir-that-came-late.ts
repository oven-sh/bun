import { nextTurns } from "../host.ts";
import { EventEmitter } from "node:events";
// Two heirs of the library's constructor function are warm when a third makes its one object. The third must not make the other two slower.
function First(this: EventEmitter): void { EventEmitter.call(this); }
Object.setPrototypeOf(First.prototype, EventEmitter.prototype);
function Second(this: EventEmitter): void { EventEmitter.call(this); }
Object.setPrototypeOf(Second.prototype, EventEmitter.prototype);
function Late(this: EventEmitter): void { EventEmitter.call(this); }
Object.setPrototypeOf(Late.prototype, EventEmitter.prototype);
type Maker = new () => EventEmitter;
const makers = [First, Second, Late] as unknown as Maker[];
let heard = 0;
const listener = (value: number): void => void (heard += value);
function bench(n: number): number {
  for (let i = 0; i < n; i++) {
    const emitter = new makers[i & 1]();
    emitter.on("told", listener);
    emitter.emit("told", 1);
  }
  return heard;
}
let check = 0;
let calls = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) {
  if (++calls === 50) new makers[2]();
  check += bench(n);
}
console.log(check);
