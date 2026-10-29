// A variable, field, parameter or result declared `int32 | Box | null` takes a value whose type has no number in it.
import type { int32 } from "bun";

class Box {
  inner: Box | null = null;
  size: int32 = 1;
  held: int32 | Box | null = null;
}

function describe(value: int32 | Box | null | string): string {
  if (value === null) return "null";
  if (typeof value === "number") return `number ${value}`;
  if (typeof value === "string") return `string ${value}`;
  return `box ${value.size}`;
}

function pick(box: Box, wantsInner: boolean): int32 | Box | null {
  if (wantsInner) return box.inner;
  return box.size;
}

const box = new Box();
box.inner = new Box();
box.inner.size = 2;

let a: int32 | Box | null = box.inner;
console.log(describe(a));
a = 7;
console.log(describe(a));
a = box.inner.inner;
console.log(describe(a));

box.held = box.inner;
console.log(describe(box.held));
box.held = box.size;
console.log(describe(box.held));

const name: string = ["x", "y"][box.size];
let b: int32 | string = name;
console.log(describe(b));
b = box.size;
console.log(describe(b));

console.log(describe(pick(box, true)), describe(pick(box, false)), describe(pick(box.inner, true)));
