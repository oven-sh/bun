// A row of a list without a written type: the word is of the contents, all the way down. The proof stands.
import type { int32 } from "bun";
const rows = [[1, 2], [3, 4]];
class Cursor { column: int32 = 0; advance(by: int32): void { this.column = rows[1]![by] ?? 0; } }
const c = new Cursor();
c.advance(1);
console.log(c.column);
export {};
