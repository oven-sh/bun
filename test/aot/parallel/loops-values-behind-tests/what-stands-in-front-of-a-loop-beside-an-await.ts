// Async functions with loops in which, beside which and around which they await. What stands in front of a loop is a raw number, the answer of a test or a read:
// none of it is alive over a suspension unless the frame saves it.
const report = (value: unknown) => console.log(String(value));
class Box { x: number; constructor(x: number) { this.x = x; } }
const other = { y: 0, x: 2.5 };
async function loopsAroundAwait(o: Box, k: number, n: number) { let s = 0; for (let r = 0; r < n; r++) { for (let i = 0; i < n; i++) s += o.x * k + i; await null; for (let i = 0; i < n; i++) s += o.x * k; } return s; }
async function loopThenAwait(o: Box, k: number, n: number) { let s = 0; for (let i = 0; i < n; i++) s += o.x * k + i; await null; s += o.x * k; for (let i = 0; i < n; i++) s += o.x * k; return s; }
async function awaitInLoop(o: Box, k: number, n: number) { let s = 0; for (let i = 0; i < n; i++) { s += o.x * k; await null; s += o.x + k; } return s; }
async function awaitInLoopInside(o: Box, k: number, n: number) { let s = 0; for (let r = 0; r < n; r++) { s += o.x * k; for (let i = 0; i < n; i++) { s += o.x; await null; s += k; } s += o.x * k; } return s; }
async function awaitOnOneWay(o: Box, k: number, n: number) { let s = 0; for (let i = 0; i < n; i++) { s += o.x * k; if (i === 1) await null; s += k; } return s; }
async function viewOverAwait(a: Float64Array, k: number, n: number) { let s = 0; for (let r = 0; r < n; r++) { for (let i = 0; i < a.length; i++) { a[i] = a[i] + k; s += a[i]; } await null; } return s; }
report(await loopsAroundAwait(new Box(2), 1.5, 3));
report(await loopsAroundAwait(other as any, 2, 3));
report(await loopsAroundAwait(new Box(2), "3" as any, 2));
report(await loopThenAwait(new Box(2), 1.5, 3));
report(await loopThenAwait(other as any, 2, 3));
report(await awaitInLoop(new Box(2), 1.5, 3));
report(await awaitInLoop(other as any, 2, 3));
report(await awaitInLoopInside(new Box(2), 1.5, 3));
report(await awaitInLoopInside(other as any, 2, 2));
report(await awaitOnOneWay(new Box(2), 1.5, 4));
report(await awaitOnOneWay(other as any, 2, 4));
report(await viewOverAwait(new Float64Array(3), 1.5, 3));
report(await viewOverAwait([1, 2, 3] as any, 2, 2));
report("end");
