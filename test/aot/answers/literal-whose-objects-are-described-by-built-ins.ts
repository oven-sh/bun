// answers: without-library
// # the same literals where each object is handed to Object.keys, JSON.stringify and Object.getOwnPropertyDescriptor: it leaves the program, so every slot takes every value and nothing is a misfit
// # f1 = row, f2 = two, f3 = describe, f4 = tell
// # RUN(FORM): walk f1 mechanisms=all-Arrivals
// # FORM-LABEL: code f1:Body
// # FORM-NOT: PropDefine
// # FORM: = NewObject {{*}}fields=[0, 3, 2, 1]
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Arrivals $SHELL
// # ALSO1: 13 of 13 of 13
// # ALSO1-NEXT: exited with 0
// # Where no function goes by what its callers leave, the judge of calls holds no call against what was left. Seen where proofs are checked at run time: there the entry by value of describe() hands its parameter on as it came.
// # RUN(PROOFS): run-in-shell mechanisms=-Arrivals testing=CheckProofsAtRunTime $SHELL
// # PROOFS: 13 of 13 of 13
// # PROOFS-NEXT: exited with 0
declare function report(value: unknown): void;
function row(a: number | undefined) { return { id: 1, tag: a, more: 2, last: "z" }; }
function two(a: number | undefined, b: number | undefined) { return { first: a, id: 1, second: b, more: 2 }; }
function describe(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => describe(row(1.5)));
tell(() => describe(row(undefined)));
tell(() => describe(row(-0)) + " " + Object.is(row(-0).tag, -0));
tell(() => describe(row(NaN)));
tell(() => describe(row(7)));
tell(() => describe(two(1.5, undefined)));
tell(() => describe(two(undefined, 2.5)));
tell(() => describe(two(3, 4)));
tell(() => "tag" in row(undefined) && Object.prototype.hasOwnProperty.call(row(undefined), "tag"));
tell(() => { const d = Object.getOwnPropertyDescriptor(row(1.5), "tag")!; return d.value + " " + d.writable + " " + d.enumerable + " " + d.configurable; });
tell(() => { let sum = 0; for (let i = 0; i < 300; i++) { const r = row(i % 3 ? i + 0.5 : undefined); sum += r.id + r.more + (r.tag === undefined ? 1 : r.tag); } return sum; });
tell(() => { const r = row(1.5); r.tag = undefined; r.more = 9; return describe(r); });
report("end");
