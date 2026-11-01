// Flags: --aot-disable=flow-results
// A typed function that was constructed and has left by a call in tail position is listed at that call, not at its head.
import { construct } from "./caller.js";
function pick(list: number[], index: number): number {
  if (index < 0) throw new RangeError("in front of the list");
  return list[index] + 1;
}
function handOn(list: number[], index: number): number {
  return pick(list, index);
}
console.log(handOn([7], 0) + 1);
console.log(construct(handOn, [[1], -1]));
console.log(construct(handOn, [undefined, 1]));
