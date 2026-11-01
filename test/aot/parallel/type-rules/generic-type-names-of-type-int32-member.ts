// Box<int32>, Box<number> and Whole list the same name. A read through Whole or Box<int32> is an int32.
import type { int32 } from "bun";
interface Box<Value> {
  value: Value;
}
interface Whole {
  value: int32;
}
function open(box: Box<int32>): int32 {
  return box.value;
}
function whole(box: Whole): int32 {
  return box.value;
}
function fraction(box: Box<number>): number {
  return box.value / 2;
}
console.log(open({ value: 3 }), whole({ value: 4 }), fraction({ value: 5 }));
