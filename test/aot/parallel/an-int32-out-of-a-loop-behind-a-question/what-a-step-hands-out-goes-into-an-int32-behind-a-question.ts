// The promise stands blocks behind the step of the loop. The walk has proven the list to hold int32s; the word of `steps` is only expected.
import type { int32 } from "bun";
const steps = [1, 2, 3, 4].slice();
const kept = [1, 2, 3].filter(n => n > 0);
class Cursor {
  column: int32 = 0;
  behindOne(why: string): string { for (const s of steps) if (s < 3) this.column = s; return why; }
  behindTwo(why: string): string { for (const s of steps) { if (s > 1) { if (s < 4) this.column = s; } } return why; }
  behindAContinue(why: string): string { for (const s of kept) { if (s === 2) continue; this.column = s; } return why; }
  behindSomethingElse(why: string): string { for (const s of steps) { if (why.length > 0) this.column = s; } return why; }
}
const c = new Cursor();
console.log(c.behindOne("a"), c.column, c.behindTwo("b"), c.column, c.behindAContinue("c"), c.column, c.behindSomethingElse("d"), c.column, c.behindSomethingElse(""), c.column);
export {};
