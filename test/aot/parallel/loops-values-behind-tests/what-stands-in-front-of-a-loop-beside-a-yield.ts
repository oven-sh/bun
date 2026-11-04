// Generators with loops in which, beside which and around which they yield. What stands in front of a loop is a raw number, the answer of a test or a read:
// none of it is alive over a suspension unless the frame saves it.
const report = (value: unknown) => console.log(String(value));
class Box { x: number; constructor(x: number) { this.x = x; } }
const other = { y: 0, x: 2.5 };
function* loopsAroundYield(o: Box, k: number, n: number) { let s = 0; for (let r = 0; r < n; r++) { for (let i = 0; i < n; i++) s += o.x * k + i; yield s; for (let i = 0; i < n; i++) s += o.x * k; } yield s; }
function* yieldInLoop(o: Box, k: number, n: number) { for (let i = 0; i < n; i++) { yield o.x * k + i; k = k + 1; } yield k; }
function drainedAround(o: Box, k: number, n: number) { let s = 0; for (const value of loopsAroundYield(o, k, n)) s = s * 3 + value; return s; }
function drainedInLoop(o: Box, k: number, n: number) { let s = 0; for (const value of yieldInLoop(o, k, n)) s = s * 3 + value; return s; }
async function* asyncGenerated(o: Box, k: number, n: number) { for (let r = 0; r < n; r++) { let s = 0; for (let i = 0; i < n; i++) s += o.x * k + i; yield s; await null; } }
async function drainedAsync(o: Box, k: number, n: number) { let s = 0; for await (const value of asyncGenerated(o, k, n)) s = s * 3 + value; return s; }
report(drainedAround(new Box(2), 1.5, 3));
report(drainedAround(other as any, 2, 3));
report(drainedInLoop(new Box(2), 1.5, 3));
report(drainedInLoop(other as any, 2, 3));
report(await drainedAsync(new Box(2), 1.5, 3));
report(await drainedAsync(other as any, 2, 3));
report("end");
