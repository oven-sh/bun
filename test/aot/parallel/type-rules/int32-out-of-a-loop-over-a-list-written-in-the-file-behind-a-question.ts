// What the checker says of a list without a written type is no word of what the list holds. The proof that every element is an int32 stands behind a question in the turn too.
import type { int32 } from "bun";
const steps = [1, 2, 3];
class Cursor { column: int32 = 0; advance(why: string): string { for (const s of steps) if (s < 3) this.column = s; return why; } }
const c = new Cursor();
const why = c.advance("a");
console.log(c.column, why);
export {};
