// count only ever holds 0, so next() only ever gives 1.
import type { int32 } from "bun";
function next(a: number): number {
  return a + 1;
}
class Counter {
  count: int32 = 0;
  peek(): int32 {
    return next(this.count);
  }
}
console.log(`${new Counter().peek()}`);
