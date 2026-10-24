// A value that was tested for null or undefined on some paths into a loop or join, but not on all.
declare const console: any;
let g: number[] | undefined;
function maybe(k: number): number[] | undefined { return k & 1 ? [k] : undefined; }
function attempt(name: string, f: () => unknown): void { let r: string; try { r = JSON.stringify(f()) ?? "undefined"; } catch (e: any) { r = "throws " + e.constructor.name; } console.log(name + ": " + r); }
function coldSideMayBeNil(k: number): number { let v = g; if (v == null) { v = maybe(k); } return v![0]; }
function hotSideUntested(k: number, c: boolean): number { let v = maybe(k); if (c) { v = [7]; } return v![0]; }
function testedOnAnotherValue(k: number): number { const a = maybe(k), b = maybe(k + 1); let v = b; if (a == null) { v = [9]; } return v![0]; }
function bothSidesSameBlock(k: number): number { const v = maybe(k); if (v == null) { } return v![0]; }
function nilSide(k: number): number { const v = maybe(k); if (v != null) return -1; return (v as any)[0]; }
function aroundALoop(n: number): number { let v: number[] | undefined = [1]; let t = 0; for (let i = 0; i < n; i++) { t += v![0]; v = maybe(i); } return t; }
function aroundALoopTested(n: number): number { let v: number[] | undefined = [1]; let t = 0; for (let i = 0; i < n; i++) { if (v == null) v = [5]; t += v[0]; v = maybe(i); } return t; }
function emptyStringIsNoNil(s: string | undefined): number { let v = s; if (!v) { v = s; } return v!.length; }
function zeroIsNoNil(n: number | undefined): string { let v = n; if (!v) { v = n; } return v!.toFixed(1); }
function negatedTwice(k: number): number { const v = maybe(k); let w = v; if (!!(v == null)) { w = maybe(k + 2); } return w![0]; }
function threeWays(k: number): number { let v: number[] | undefined; switch (k) { case 0: v = [0]; break; case 1: v = maybe(1); break; default: v = maybe(k); } return v![0]; }
function throughTwoJoins(k: number, c: boolean): number { let v = maybe(k); if (v == null) { v = c ? [3] : maybe(k); } let w = v; if (c) { w = v; } return w![0]; }
function underAHandler(k: number): number { let v: number[] | undefined = [1]; try { v = maybe(k); if (k === 4) throw new Error("x"); v = [2]; } catch { } return v![0]; }
function changedBehindTheTest(k: number): number { let v = maybe(1); if (v != null) { v = maybe(k); return v![0]; } return -1; }
function castAway(k: number): number { const v = maybe(k) as number[]; let w = v; if (k > 100) w = [1]; return w[0]; }
for (let k = 0; k < 4; k++) {
    attempt("coldSideMayBeNil " + k, () => coldSideMayBeNil(k)); attempt("hotSideUntested " + k, () => hotSideUntested(k, k > 1)); attempt("testedOnAnotherValue " + k, () => testedOnAnotherValue(k));
    attempt("bothSidesSameBlock " + k, () => bothSidesSameBlock(k)); attempt("nilSide " + k, () => nilSide(k)); attempt("aroundALoop " + k, () => aroundALoop(k)); attempt("aroundALoopTested " + k, () => aroundALoopTested(k));
    attempt("negatedTwice " + k, () => negatedTwice(k)); attempt("threeWays " + k, () => threeWays(k)); attempt("throughTwoJoins " + k, () => throughTwoJoins(k, k > 1)); attempt("changedBehindTheTest " + k, () => changedBehindTheTest(k));
}
attempt("underAHandler 4", () => underAHandler(4)); attempt("underAHandler 3", () => underAHandler(3));
attempt("empty string", () => emptyStringIsNoNil("")); attempt("undefined string", () => emptyStringIsNoNil(undefined)); attempt("a string", () => emptyStringIsNoNil("ab"));
attempt("zero", () => zeroIsNoNil(0)); attempt("undefined number", () => zeroIsNoNil(undefined)); attempt("a number", () => zeroIsNoNil(2));
g = [42]; attempt("the variable is set", () => coldSideMayBeNil(0));
export {};
