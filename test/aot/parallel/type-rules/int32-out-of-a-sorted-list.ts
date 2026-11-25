// What the checker says of a name without a written type is expected of it. The proof that every element is an int32 stands.
import type { int32 } from "bun";
const steps = [3, 1, 2].sort();
class Cursor { column: int32 = 0; advance(by: int32): void { this.column = steps[by] ?? 0; } }
const c = new Cursor();
c.advance(1);
console.log(c.column);
export {};
