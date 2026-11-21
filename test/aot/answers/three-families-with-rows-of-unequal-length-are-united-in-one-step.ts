// answers: without-library
// # Three families of functions that have met, each called, so each has a row of parameters of its own: of one place, of two, of one. `late` is reached only through c1, when all three rows stand; there the first two families are united, and in the next step of the same flow the third, the largest, takes them in. Both ties wait together.
// # Rows are tied place by place as they stand, so they are tied in the order of the unions: the row that is absorbed has all its places before it is tied to the row that lives. Newest first, the first family's row would get its second place behind its own tie, the row that lives would never hear of it, and the text that the last call passes there would not come to b1.
// # f8 = b1
// # OPTIONS: check=FlowFixpoint
// # RUN(HELD): link held functions mechanisms=all
// # HELD-NOT: FlowEndedTooEarly
// # HELD: function f8 
// # HELD: parameter 1 expected=undefined|i32|string proven=undefined|i32|string
// # At the end the shell runs the same text itself: every answer is the same.
// # A variable that holds eight functions or fewer is followed function by function: the families here have nine and more.
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
function a6(x: number): number { let sum = 0; for (let k = 0; k < x; k++) sum += k; return sum; }
function a7(x: number): number { return 107; }
function a8(x: number): number { return 108; }
function a9(x: number): number { return 109; }
function a10(x: number): number { return 110; }
let a: Step = a1;
if (n > 5) a = a2;
if (n > 6) a = a3;
if (n > 7) a = a4;
if (n > 8) a = a5;
if (n > 9) a = a6;
if (n > 10) a = a7;
if (n > 11) a = a8;
if (n > 12) a = a9;
if (n > 13) a = a10;
function b1(x: number, y?: unknown): number { seen.right = y; return 11; }
function b2(x: number, y?: unknown): number { return 12; }
function b3(x: number, y?: unknown): number { return 13; }
function b4(x: number, y?: unknown): number { return 14; }
function b5(x: number, y?: unknown): number { let sum = 0; for (let k = 0; k < x; k++) sum += k; return sum; }
function b6(x: number, y?: unknown): number { return 206; }
function b7(x: number, y?: unknown): number { return 207; }
function b8(x: number, y?: unknown): number { return 208; }
function b9(x: number, y?: unknown): number { return 209; }
let b: Step = b1;
if (n > 5) b = b2;
if (n > 6) b = b3;
if (n > 7) b = b4;
if (n > 8) b = b5;
if (n > 9) b = b6;
if (n > 10) b = b7;
if (n > 11) b = b8;
if (n > 12) b = b9;
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
function c13(x: number): number { return 313; }
function c14(x: number): number { return 314; }
function c15(x: number): number { return 315; }
function c16(x: number): number { return 316; }
function c17(x: number): number { return 317; }
function c18(x: number): number { return 318; }
function c19(x: number): number { return 319; }
function c20(x: number): number { return 320; }
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
if (n > 16) c = c13;
if (n > 17) c = c14;
if (n > 18) c = c15;
if (n > 19) c = c16;
if (n > 20) c = c17;
if (n > 21) c = c18;
if (n > 22) c = c19;
if (n > 23) c = c20;
let left: Step | undefined;
let all: Step | undefined;
function late(): void { left = a; if (n) left = b; all = left; if (n > 5) all = c; report(all(1, "text")); }
report(a(7));
report(b(7, 8));
report(c(9));
report(typeof seen.right);
report(seen.right === "text");
report("end");
