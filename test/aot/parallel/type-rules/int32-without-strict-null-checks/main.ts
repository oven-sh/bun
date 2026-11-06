import type { int32 } from "bun";

interface Point {
  x: int32;
  y?: int32;
}
function sum(p: Point): number {
  return p.y + 1;
}
function next(n?: int32): number {
  return n + 1;
}
console.log(sum({ x: 1 }), sum({ x: 1, y: 2 }), next(), next(4));

let kept: int32 = 0;
function assignedLater(a: int32, flag: boolean): int32 {
  var x: int32;
  if (flag) x = a;
  else x = 1;
  return x;
}
function throughLocal(p: Point): int32 {
  var x = p.x;
  return x;
}
function bounded(text: string): int32 {
  let last: int32 = 0;
  for (let i: int32 = 0; i < text.length; i++) last = i;
  return last;
}
function store(a: int32): void {
  kept = a;
}
store(7);
console.log(assignedLater(3, true), assignedLater(3, false), throughLocal({ x: 5 }), bounded("four"), kept);
