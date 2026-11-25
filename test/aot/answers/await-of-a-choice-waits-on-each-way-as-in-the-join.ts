// answers: without-library
// # the await at the head of a join stays in the join. Every way waits once, a value that lives across the await is the same behind it, and a rejection arrives in the handler round the join
// # f1 = load, f5 = run, f6 = runThree, f7 = runUnderTry, f8 = runInLoop
// # RUN(FORM): walk f5:CoroutineBody mechanisms=all-Inlining
// # FORM-LABEL: code f5:CoroutineBody
// # FORM-NOT: = AwaitCallBySavingFrame
// # RUN(THREE): walk f6:CoroutineBody mechanisms=all-Inlining
// # THREE-LABEL: code f6:CoroutineBody
// # THREE-NOT: = AwaitCallBySavingFrame
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 27 of 27 of 27
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
async function load(x: unknown) { log += "a"; await null; log += "b"; return x; }
async function fail(x: unknown) { log += "c"; await null; throw "failed " + x; }
function cached(x: unknown) { log += "d"; return x; }
async function run(hit: boolean, x: unknown) { const kept = "k" + x; const v = await (hit ? cached(x) : load(x)); log += "e"; return kept + v; }
async function runThree(which: number, x: unknown) { const v = await (which === 0 ? cached(x) : which === 1 ? load(x) : fail(x)); log += "f"; return v; }
async function runUnderTry(hit: boolean, x: unknown) { try { return await (hit ? cached(x) : fail(x)); } catch (e) { return "caught " + e; } finally { log += "g"; } }
async function runInLoop(n: number) { let s = 0; for (let i = 0; i < n; i++) s += await (i % 2 ? cached(i) : load(i)) as number; return s; }
async function beside() { log += "1"; await null; log += "2"; await null; log += "3"; await null; log += "4"; }
const thenable = { then(resolve: (v: unknown) => void) { log += "t"; resolve("T"); } };
async function tell(started: Promise<unknown>) { const other = beside(); try { report(await started); } catch (e) { report("thrown " + e); } await other; report(log); log = ""; }
async function runKeeps(hit: boolean, x: unknown) { const p = load(x); const v = await (hit ? cached(x) : p); return typeof p + " " + typeof v + " " + (await p); }
async function runBehindTry(x: unknown) { let p: unknown; try { p = fail(x); } catch (e) { p = "caught at the call"; } const v = await p; return v; }
await tell(run(true, 1));
await tell(run(false, 2));
await tell(run(true, thenable));
await tell(run(false, thenable));
await tell(runThree(0, 3));
await tell(runThree(1, 4));
await tell(runThree(2, 5));
await tell(runUnderTry(true, 6));
await tell(runUnderTry(false, 7));
await tell(runInLoop(5));
await tell(runKeeps(true, 8));
await tell(runKeeps(false, 9));
await tell(runBehindTry(10));
report("end");
