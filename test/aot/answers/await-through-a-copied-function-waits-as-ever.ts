// answers: without-library
// # the awaited call enters a plain function that returns a call of an async function at once. Copied, that call goes on to the await of the caller: same answers, same order of jobs
// # a rejection arrives at the await and never in a handler of the copied function, and a function with a second way out keeps the await behind it
// # f1 = load, f3 = get, f9 = run, f11 = runUnderTry, f12 = runEither
// # RUN(FORM): walk f9:CoroutineBody mechanisms=all
// # FORM-LABEL: code f9:CoroutineBody
// # FORM: = AwaitCallBySavingFrame
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
async function load(x: unknown) { log += "a"; await null; log += "b"; return x; }
async function fail(x: unknown) { log += "c"; await null; throw "failed " + x; }
function get(x: unknown) { return load(x); }
function getFailing(x: unknown) { return fail(x); }
function getUnderTry(x: unknown) { try { return fail(x); } catch (e) { return "caught inside " + e; } }
function getEither(x: unknown) { return x === undefined ? x : load(x); }
async function run(x: unknown) { const v = await get(x); log += "e"; return v; }
async function runFailing(x: unknown) { try { return await getFailing(x); } catch (e) { return "caught outside " + e; } }
async function runUnderTry(x: unknown) { try { return await getUnderTry(x); } catch (e) { return "caught outside " + e; } }
async function runEither(x: unknown) { const v = await getEither(x); log += "f"; return v; }
async function beside() { log += "1"; await null; log += "2"; await null; log += "3"; await null; log += "4"; }
async function tell(started: Promise<unknown>) { const other = beside(); report(await started); await other; report(log); log = ""; }
function getOf(box: Box) { return load(box.x + box.y); }
async function runGuarded(box: Box) { const v = await getOf(box); return "" + v; }
class Box { x = 1; y = 2; }
await tell(run(1));
await tell(run("text"));
await tell(runFailing(2));
await tell(runUnderTry(3));
await tell(runEither(undefined));
await tell(runEither(4));
await tell(runGuarded(new Box()));
await tell(runGuarded({ x: "a", y: "b" } as any));
report("end");
