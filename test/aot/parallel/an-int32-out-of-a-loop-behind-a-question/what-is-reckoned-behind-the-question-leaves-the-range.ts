import type { int32 } from "bun";
const steps = [1, 2, 2147483647].slice();
class Cursor { column: int32 = 0; advance(why: string): string { for (const s of steps) if (s > 1) this.column = s + 1; return why; } }
const c = new Cursor(); console.log(c.advance("a"), c.column);
export {};
/* Build errors:
error: TS100031: Property 'column' of 'Cursor' is declared 'int32', but 's + 1' might not be an int32: it can be anything from 3 to 2147483648. Write '(s + 1) | 0'.
*/
