// answers: without-library
// # the ramp of an async function is built at its call in a loop. Each turn gets a promise of its own, the body runs up to its first await at the call, and a body that throws gives a rejected promise and never throws into the loop
// # f1 = load, f2 = failEarly, f3 = plain, f4 = plainThrows, f5 = startAll, f6 = startFailing, f8 = startPlainThrowing
// # RUN(FORM): walk f5 mechanisms=all
// # FORM-LABEL: code f5:Body
// # FORM: = CallDirect {{*}}role=CoroutineBody
// # RUN(FAILING): walk f6 mechanisms=all
// # FAILING-LABEL: code f6:Body
// # FAILING: = CallDirect {{*}}role=CoroutineBody
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 38 of 38 of 38
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
async function load(x: number) { log += "a" + x; await null; log += "b" + x; return x * 2; }
async function failEarly(x: number) { log += "c" + x; if (x > 0) throw "early " + x; await null; return x; }
async function plain(x: number) { log += "p" + x; return x + 1; }
async function plainThrows(x: number) { log += "q" + x; if (x === 1) throw "plain " + x; return x; }
function startAll(n: number) { const started: Promise<number>[] = []; for (let i = 0; i < n; i++) started[i] = load(i); return started; }
function startFailing(n: number) { const started: Promise<number>[] = []; for (let i = 0; i < n; i++) started[i] = failEarly(i); return started; }
function startPlain(n: number) { const started: Promise<number>[] = []; for (let i = 0; i < n; i++) started[i] = plain(i); return started; }
function startPlainThrowing(n: number) { const started: Promise<number>[] = []; for (let i = 0; i < n; i++) started[i] = plainThrows(i); return started; }
async function tell(started: Promise<number>[]) { report(log); report(started.length); report(started[0] === started[1]); for (let i = 0; i < started.length; i++) { try { report(await started[i]); } catch (e) { report("thrown " + e); } } report(log); log = ""; }
await tell(startAll(3));
await tell(startFailing(3));
await tell(startPlain(3));
await tell(startPlainThrowing(3));
await tell(startAll(0));
await tell(startAll(1));
report("end");
