// A number that is made ahead of a test and converted to an integer behind it, in a part of the function that calls: a built-in known only through a parameter that may be nil (Math.imul, Math.clz32, Math.floor), handed a sum, a difference, a quotient or Math.trunc of something.
declare const console: { log(...values: unknown[]): void };
type F1 = (a: number) => number;
type F2 = (a: number, b: number) => number;
function maybeAsFound(fn: F2 | null, a: number, b: number): number { return fn ? fn(a, b) : -1; }
function goAsFound(k: number): number { return maybeAsFound(Math.imul, 1e10, k + 0.25); }
function maybeSmallInteger(fn: F2 | null, a: number, b: number): number { return fn ? fn(a, b) : -1; }
function goSmallInteger(k: number): number { return maybeSmallInteger(Math.imul, 3, k + 0.25); }
function maybeNoTailCall(fn: F2 | null, a: number, b: number): number { if (!fn) return -1; const r = fn(a, b); return r + 1; }
function goNoTailCall(k: number): number { return maybeNoTailCall(Math.imul, 3, k + 0.25); }
function maybeUndefined(fn: F2 | undefined, a: number, b: number): number { return fn ? fn(a, b) : -1; }
function goUndefined(k: number): number { return maybeUndefined(Math.imul, 3, k + 0.25); }
function maybeIf(fn: F2 | null, a: number, b: number): number { if (fn) return fn(a, b); return -1; }
function goIf(k: number): number { return maybeIf(Math.imul, 3, k + 0.25); }
function maybeClz32(fn: F1 | null, a: number): number { return fn ? fn(a) : -1; }
function goClz32(k: number): number { return maybeClz32(Math.clz32, k + 0.25); }
function maybeNotNil(fn: F2, a: number, b: number): number { return fn(a, b); }
function goNotNil(k: number): number { return maybeNotNil(Math.imul, 3, k + 0.25); }
function maybeAtan2(fn: F2 | null, a: number, b: number): number { return fn ? fn(a, b) : -1; }
function goAtan2(k: number): number { return maybeAtan2(Math.atan2, 3, k + 0.25); }
function maybePlainParameters(fn: F2 | null, a: number, b: number): number { return fn ? fn(a, b) : -1; }
function goPlainParameters(k: number): number { return maybePlainParameters(Math.imul, k, k); }
function maybeSumInside(fn: F2 | null, a: number, b: number): number { return fn ? fn(a, b + 0.25) : -1; }
function goSumInside(k: number): number { return maybeSumInside(Math.imul, 3, k); }
function maybeProduct(fn: F2 | null, a: number, b: number): number { return fn ? fn(a, b) : -1; }
function goProduct(k: number): number { return maybeProduct(Math.imul, 3, k * 0.25); }
function goDirect(k: number): number { const s = k + 0.25; return k > 0 ? Math.imul(3, s) : -1; }
function goOrZero(k: number): number { const s = k + 0.25; return k > 0 ? s | 0 : -1; }
function maybeDifference(fn: F2 | null, a: number, b: number): number { return fn ? fn(a, b) : -1; }
function goDifference(k: number): number { return maybeDifference(Math.imul, 3, k - 0.25); }
function maybeConstantFirst(fn: F2 | null, a: number, b: number): number { return fn ? fn(a, b) : -1; }
function goConstantFirst(k: number): number { return maybeConstantFirst(Math.imul, 3, 0.25 + k); }
function maybeQuotient(fn: F2 | null, a: number, b: number): number { return fn ? fn(a, b) : -1; }
function goQuotient(k: number): number { return maybeQuotient(Math.imul, 3, (k + 7) / k); }
function maybeTrunc(fn: F2 | null, a: number, b: number): number { return fn ? fn(a, b) : -1; }
function goTrunc(k: number): number { return maybeTrunc(Math.imul, 3, Math.trunc(k * 1.75)); }
function maybeFloorOfQuotient(fn: F1 | null, a: number): number { return fn ? fn(a) : -1; }
function goFloorOfQuotient(k: number): number { return maybeFloorOfQuotient(Math.floor, (k + 7) / k); }
function maybeTwoIntegers(fn: F2 | null, a: number, b: number): number { return fn ? fn(a, b) : -1; }
function goTwoIntegers(k: number): number { return maybeTwoIntegers(Math.imul, 3, k + k); }
function note(text: string): void { noted.push(text); }
const noted: string[] = [];
function sumBehindCall(k: number): number { const s = k + 0.25; if (k > 1) { note("sum " + k); return s | 0; } return -1; }
function differenceBehindCall(k: number): number { const s = k - 0.75; if (k > 1) { note("difference " + k); return s >>> 0; } return -1; }
function quotientBehindCall(k: number): number { const q = (k + 9) / k; if (k > 1) { note("quotient " + k); return q | 0; } return -1; }
function floorBehindCall(k: number): number { const q = (k + 9) / k; if (k > 1) { note("floor " + k); return Math.floor(q); } return -1; }
function truncBehindCall(k: number): number { const t = Math.trunc(k * 2.75); if (k > 1) { note("trunc " + k); return t & 255; } return -1; }
console.log("AsFound", goAsFound(1), goAsFound(2), goAsFound(3));
console.log("SmallInteger", goSmallInteger(1), goSmallInteger(2), goSmallInteger(3));
console.log("NoTailCall", goNoTailCall(1), goNoTailCall(2), goNoTailCall(3));
console.log("Undefined", goUndefined(1), goUndefined(2), goUndefined(3));
console.log("If", goIf(1), goIf(2), goIf(3));
console.log("Clz32", goClz32(1), goClz32(2), goClz32(3));
console.log("NotNil", goNotNil(1), goNotNil(2), goNotNil(3));
console.log("Atan2", goAtan2(1), goAtan2(2), goAtan2(3));
console.log("PlainParameters", goPlainParameters(1), goPlainParameters(2), goPlainParameters(3));
console.log("SumInside", goSumInside(1), goSumInside(2), goSumInside(3));
console.log("Product", goProduct(1), goProduct(2), goProduct(3));
console.log("Direct", goDirect(1), goDirect(2), goDirect(3));
console.log("OrZero", goOrZero(1), goOrZero(2), goOrZero(3));
console.log("Difference", goDifference(1), goDifference(2), goDifference(3));
console.log("ConstantFirst", goConstantFirst(1), goConstantFirst(2), goConstantFirst(3));
console.log("Quotient", goQuotient(1), goQuotient(2), goQuotient(3));
console.log("Trunc", goTrunc(1), goTrunc(2), goTrunc(3));
console.log("FloorOfQuotient", goFloorOfQuotient(1), goFloorOfQuotient(2), goFloorOfQuotient(3));
console.log("TwoIntegers", goTwoIntegers(1), goTwoIntegers(2), goTwoIntegers(3));
{ const row: number[] = []; for (let k = 1; k < 6; k++) row.push(sumBehindCall(k)); console.log("sumBehindCall", row.join(" ")); }
{ const row: number[] = []; for (let k = 1; k < 6; k++) row.push(differenceBehindCall(k)); console.log("differenceBehindCall", row.join(" ")); }
{ const row: number[] = []; for (let k = 1; k < 6; k++) row.push(quotientBehindCall(k)); console.log("quotientBehindCall", row.join(" ")); }
{ const row: number[] = []; for (let k = 1; k < 6; k++) row.push(floorBehindCall(k)); console.log("floorBehindCall", row.join(" ")); }
{ const row: number[] = []; for (let k = 1; k < 6; k++) row.push(truncBehindCall(k)); console.log("truncBehindCall", row.join(" ")); }
console.log(noted.length, noted[0], noted[noted.length - 1]);
