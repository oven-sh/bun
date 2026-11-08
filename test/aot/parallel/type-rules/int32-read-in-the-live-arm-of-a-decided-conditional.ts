// The test of the conditional is decided where the file is built, so one arm is never lowered. What flows is read out of an int32 in the other arm, and the build has nothing to prove.
// The getter under a symbol keeps the engine from seeing through `new Factory().point` to the number itself.
import type { int32 } from "bun";
class Point { x: int32 = 1; constructor(x: int32 = 1) { this.x = x; } }
const mark: unique symbol = Symbol("mark");
class Factory { get point(): Point { return new Point(5); } get [mark](): Point { return new Point(13); } }
function take(n: int32): int32 { return n; }
function make(): Factory { return new Factory(); }
let at = 0;
const on = true;
console.log(
  take(at === 0 ? new Factory().point.x : make().point.x),
  take(at !== 0 ? make().point.x : new Factory().point.x),
  take(on ? make().point.x : new Factory()[mark].x),
  take(at === 0 ? (on ? make()[mark].x : make().point.x) : new Factory().point.x),
);
