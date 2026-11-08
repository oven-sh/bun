// answers: with-library
// # Promise.all of a list that is written in the call: one operation takes the elements, and the listed calls of known async functions enter their bodies without a promise
// # the elements are values, thenables, one whose getter throws, promises, and calls that fail late, early and twice. The result, the first failure and the order of jobs are those of the built-in on a list
// # f1 = a, f2 = b, f8 = both, f9 = withFailure, f14 = ofValues
// # LIBRARY: own
// # RUN(FORM): walk f8 mechanisms=all
// # FORM-LABEL: code f8:Body
// # FORM: = PromiseAllOfElements {{*}}directCalls=3
// # RUN(FAILURE): walk f9 mechanisms=all
// # FAILURE-LABEL: code f9:Body
// # FAILURE: = PromiseAllOfElements {{*}}directCalls=7
// # RUN(VALUES): walk f14 mechanisms=all
// # VALUES-LABEL: code f14:Body
// # VALUES: = PromiseAllOfElements
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 30 of 30 of 30
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
async function a(x: unknown) { log += "a"; await null; log += "A"; return x; }
async function b(x: unknown) { log += "b"; await null; await null; log += "B"; return x; }
async function fails(x: unknown) { log += "f"; await null; throw "failed " + x; }
async function failsEarly(x: unknown) { log += "g"; if (x !== log) throw "early " + x; await null; return x; }
async function plain(x: unknown) { log += "p"; return x; }
function both(x: unknown) { return Promise.all([a(x), b(x), x]); }
function withFailure(x: unknown) { return Promise.all([a(x), fails(x), b(x)]); }
function withTwoFailures(x: unknown) { return Promise.all([fails(x), failsEarly(x)]); }
function withEarlyFailure(x: unknown) { return Promise.all([failsEarly(x), a(x)]); }
function withPlain(x: unknown) { return Promise.all([plain(x), a(x), plain(x)]); }
function ofNothing() { return Promise.all([]); }
function ofValues(x: unknown, y: unknown) { return Promise.all([x, y]); }
function ofOneCall(x: unknown) { return Promise.all([a(x)]); }
async function awaited(x: unknown) { const [first, second] = await Promise.all([a(x), b(x)]); return "" + first + second; }
async function beside() { log += "1"; await null; log += "2"; await null; log += "3"; await null; log += "4"; await null; log += "5"; }
const thenable = { then(resolve: (v: unknown) => void) { log += "t"; resolve("T"); } };
const throwsInGetter = { get then(): unknown { log += "w"; throw "no then"; } };
async function tell(started: Promise<unknown>) { const other = beside(); try { const given = await started; report(typeof given === "string" ? given : (given as unknown[]).length + ":" + (given as unknown[]).join()); } catch (e) { report("thrown " + e); } await other; report(log); log = ""; }
function withHole(x: unknown) { return Promise.all([a(x), , x]); }
async function plainFails(x: unknown) { log += "q"; throw "plain " + x; }
function withPlainFailure(x: unknown) { return Promise.all([a(x), plainFails(x)]); }
await tell(both(1));
await tell(both(thenable));
await tell(both(throwsInGetter));
await tell(withFailure(2));
await tell(withTwoFailures(3));
await tell(withEarlyFailure(4));
await tell(withPlain(5));
await tell(ofNothing());
await tell(ofValues(6, thenable));
await tell(ofValues(a(7), b(8)));
await tell(ofOneCall(9));
await tell(awaited("z"));
await tell(withHole(10));
await tell(withPlainFailure(11));
report(both(1) === both(1));
report("end");
