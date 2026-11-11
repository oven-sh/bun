// What the checker says of a list without a written type is expected of it. The proof that every element is an int32 stands.
import type { int32 } from "bun";
const steps = [1, 2, 3];
class Cursor { column: int32 = 0; all(by: int32): int32 { for (const s of steps) this.column = s; return by; } }
const c = new Cursor();
console.log(c.all(1), c.column);
