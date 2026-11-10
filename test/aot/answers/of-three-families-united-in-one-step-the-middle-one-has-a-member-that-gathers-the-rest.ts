// answers: without-library
// # The program of three-families-with-rows-of-unequal-length-are-united-in-one-step.ts, but b1 gathers what is passed behind its first parameter, and no call in sight of its own family passes anything there. What a row gathers is tied like its places: in the order of the unions.
// # Under the checking word every function that is tied in is tied in once more when the flow is at rest: it hears the row of its family that lives; what that brings anew is a breach.
// # OPTIONS: check=FlowFixpoint
// # RUN(CLOSED): link held functions mechanisms=all
// # CLOSED-NOT: FlowEndedTooEarly
// # CLOSED: function f0
// # At the end the shell runs the same text itself: every answer is the same.
// # The witness counts its event: two rows are tied, of unequal length, and one of the ties stands behind another of the same settling, whose kept row it absorbs.
// # RUN(TIES): link counts mechanisms=all
// # TIES: counts flow ties of the rows of lost functions
// # TIES-NOT: lost functions | all 0 |
// # TIES-NOT: of rows of unequal length 0 |
// # TIES-NOT: of the same settling 0 |
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
type Step = (x: number, y?: unknown) => number;
const seen: { right: unknown } = { right: 0 };
const n: number = +(globalThis as any).nothingIsHere || 1;
function a1(x: number): number { return 1; }
function a2(x: number): number { return 2; }
function a3(x: number): number { return 3; }
function a4(x: number): number { return 4; }
function a5(x: number): number { return 5; }
function a6(x: number): number { return 6; }
let a: Step = a1;
if (n > 5) a = a2;
if (n > 6) a = a3;
if (n > 7) a = a4;
if (n > 8) a = a5;
if (n > 9) a = a6;
function b1(x: number, ...rest: unknown[]): number { if (rest.length) seen.right = rest[rest.length - 1]; return 11; }
function b2(x: number, y?: unknown): number { return 12; }
function b3(x: number, y?: unknown): number { return 13; }
function b4(x: number, y?: unknown): number { return 14; }
function b5(x: number, y?: unknown): number { return 15; }
let b: Step = b1;
if (n > 5) b = b2;
if (n > 6) b = b3;
if (n > 7) b = b4;
if (n > 8) b = b5;
function c1(x: number): number { late(); return 21; }
function c2(x: number): number { return 22; }
function c3(x: number): number { return 23; }
function c4(x: number): number { return 24; }
function c5(x: number): number { return 25; }
function c6(x: number): number { return 26; }
function c7(x: number): number { return 27; }
function c8(x: number): number { return 28; }
function c9(x: number): number { return 29; }
function c10(x: number): number { return 30; }
function c11(x: number): number { return 31; }
function c12(x: number): number { return 32; }
let c: Step = c1;
if (n > 5) c = c2;
if (n > 6) c = c3;
if (n > 7) c = c4;
if (n > 8) c = c5;
if (n > 9) c = c6;
if (n > 10) c = c7;
if (n > 11) c = c8;
if (n > 12) c = c9;
if (n > 13) c = c10;
if (n > 14) c = c11;
if (n > 15) c = c12;
let left: Step | undefined;
let all: Step | undefined;
function late(): void { left = a; if (n) left = b; all = left; if (n > 5) all = c; report(all(1, "text")); }
report(a(7));
report(b(7));
report(c(9));
report(typeof seen.right);
report(seen.right === "text");
report("end");
