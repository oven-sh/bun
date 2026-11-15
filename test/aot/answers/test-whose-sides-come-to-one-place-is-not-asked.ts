// answers: without-library
// # both sides of a branch come to one place: the test is not asked. What computes its subject still runs: a getter counts, throws, and no object is converted by a test for truth or by a case
// # f5 = quiet, f1 = same, f2 = differs, f6 = some, f7 = none, f8 = falls, f9 = oneSide, f3 = readsOnOneSide, f4 = tell, f10 = each
// # RUN(FORM): walk f5 f1 mechanisms=none+Folding
// # FORM-NOT: Branch
// # RUN(WRITTEN): walk f5 mechanisms=none
// # WRITTEN-LABEL: code f5:Body
// # WRITTEN-NOT: Branch
// # RUN(KEPT): walk f2 mechanisms=none+Folding
// # KEPT-LABEL: code f2:Body
// # KEPT: Branch
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 105 of 105 of 105
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let reads = 0;
const counted = { get flag() { reads++; return reads & 1; }, get kind() { reads += 10; return 1; } };
const thrower = { get flag(): unknown { throw new RangeError("flag"); }, get kind(): unknown { throw new RangeError("kind"); } };
const converted = { flag: { valueOf() { reads += 100; return 0; } }, kind: { valueOf() { reads += 100; return 1; } } };
function quiet(o: any) { if (o.flag) { } return reads; }
function same(o: any, v: unknown) { const x = o.flag ? v : v; return x; }
function differs(o: any, v: unknown) { const x = o.flag ? v : "other"; return x; }
function some(o: any) { let seen = "none"; switch (o.kind) { case 1: break; case 2: seen = "two"; break; case 3: break; } return seen; }
function none(o: any) { switch (o.kind) { case "a": break; case "b": break; } return reads; } // @ts-expect-error
function falls(o: any) { let seen = ""; switch (o.kind) { case 1: case 2: seen += "low"; case 3: break; default: seen += "rest"; } return seen; }
function oneSide(o: any) { let seen = "none"; if (o.flag) { reads += 1000; } return seen + reads; }
function readsOnOneSide(o: any, other: any) { if (o.flag) { other.flag; } return reads; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report(e instanceof RangeError ? "range " + e.message : (e as Error).name); } }
function each(f: (o: any) => unknown) { tell(() => f(counted)); tell(() => f(counted)); report(reads); tell(() => f(thrower)); tell(() => f(converted)); report(reads); tell(() => f({ flag: 1, kind: 2 })); tell(() => f({ flag: 0, kind: 3 })); tell(() => f({ flag: "", kind: "a" })); tell(() => f({ kind: 2.5 })); tell(() => f({ kind: NaN })); tell(() => f({ kind: "2" })); tell(() => f(null)); }
each(quiet);
each(o => same(o, "same"));
each(o => differs(o, "taken"));
each(some);
each(none);
each(falls);
each(oneSide);
each(o => readsOnOneSide(o, counted));
report("end");
