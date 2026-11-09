// answers: without-library
// # an awaited call of a known async function enters the body without a promise. It gives what the call and the await give, throws where they throw, and takes as many turns of the job queue: the log is written beside another function that awaits
// # the callee returns plain values, thenables that resolve at once and twice, one whose getter throws, and a promise. It throws in front of its first await and behind it
// # f1 = load, f7 = run, f8 = runLate, f9 = runEarly, f10 = runTwice
// # RUN(FORM): walk f7:CoroutineBody mechanisms=all
// # FORM-LABEL: code f7:CoroutineBody
// # FORM: = AwaitCallBySavingFrame
// # RUN(LATE): walk f8:CoroutineBody mechanisms=all
// # LATE-LABEL: code f8:CoroutineBody
// # LATE: = AwaitCallBySavingFrame
// # RUN(TWICE): walk f10:CoroutineBody mechanisms=all
// # TWICE-LABEL: code f10:CoroutineBody
// # TWICE-COUNT-2: = AwaitCallBySavingFrame
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 25 of 25 of 25
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
async function load(x: unknown) { log += "a"; await null; log += "b"; return x; }
async function failLate(x: unknown) { log += "c"; await null; throw "late " + x; }
async function failEarly(x: unknown) { log += "d"; if (x !== log) throw "early " + x; await null; return x; }
async function run(x: unknown) { const v = await load(x); log += "e"; return v; }
async function runLate(x: unknown) { try { return await failLate(x); } catch (e) { return "caught " + e; } finally { log += "f"; } }
async function runEarly(x: unknown) { try { return await failEarly(x); } catch (e) { return "caught " + e; } finally { log += "g"; } }
async function runTwice(x: number) { const a = x * 1.5; const first = await load(a) as number; const second = await load(first + a) as number; return a + first + second; }
async function beside() { log += "1"; await null; log += "2"; await null; log += "3"; await null; log += "4"; await null; log += "5"; }
const resolvesAtOnce = { then(resolve: (v: unknown) => void) { log += "t"; resolve("from then"); } };
const resolvesTwice = { then(resolve: (v: unknown) => void) { log += "u"; resolve("once"); resolve("twice"); } };
const throwsInGetter = { get then(): unknown { log += "w"; throw "no then"; } };
async function tell(started: Promise<unknown>) { const other = beside(); try { report(await started); } catch (e) { report("thrown " + e); } await other; report(log); log = ""; }
async function plainFails(x: number) { log += "h"; if (x === 1) throw "plain " + x; return x; }
async function runPlainInLoop(n: number) { let s = ""; for (let i = 0; i < n; i++) { try { s += await plainFails(i); } catch (e) { s += "[" + e + "]"; } log += "i"; } return s; }
function twice(x: number) { return x * 2; }
async function runNested(x: number) { return await load(twice(x)); }
await tell(run(1));
await tell(run("text"));
await tell(run(undefined));
await tell(run(resolvesAtOnce));
await tell(run(resolvesTwice));
await tell(run(throwsInGetter));
await tell(run(run(2)));
await tell(runLate(3));
await tell(runEarly(4));
await tell(runTwice(5));
await tell(runPlainInLoop(3));
await tell(runNested(6));
report("end");
