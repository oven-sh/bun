import type { int32 } from "bun";
const steps = [1, 2, 3].slice();
class Cursor { column: int32 = 0; advance(why: string): string { for (const s of steps) if (s < 3) this.column = s; return why; } }
steps.push(0.5);
const c = new Cursor(); console.log(c.advance("a"), c.column);
export {};
/* Build errors:
error: TS100031: Property 'column' of 'Cursor' is declared 'int32', but 's' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 's | 0'.
*/
