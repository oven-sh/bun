// answers: without-library
// # A loop over views under its counter: `for (let i = from; i < to; i += step) sum = (sum + cells[i] + cells[i + 1]) | 0`. Nothing says that i and i + 1 lie inside: until now each read stayed `undefined|i32`, was boxed into an
// # optional double, added as a double and cut back to an int32, and each store asked the length. Now the loop is built twice for that alone: in front of the typed build the room of each view beside its addend is read, and the head
// # of the typed build asks the counter against the lesser of the bound and the least room: one test a turn, as written; every access under the counter lies inside and gives the element's own type. Where that test fails the turn is
// # handed to the other build at its head, which asks the bound as written: so what lies behind the end (a bound past the length, a look one element ahead, a view that has shrunk, was detached or lies about its length) is read as
// # it always was, and what enters below zero, or steps down, takes the other build from the start.
// # f4 = sumByStride, f5 = countAbove, f1 = copyRow, f6 = dot
// # RUN(FORM): walk f4 f5 f1 f6 mechanisms=all
// # FORM-LABEL: code f4:Body
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # FORM-LABEL: code f5:Body
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # FORM-LABEL: code f1:Body
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # FORM: = PutTypedArrayElement {{*}}isInsideView
// # FORM-LABEL: code f6:Body
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # RUN(COUNT): compile CountersHeldBelowRoomOfViews
// # COUNT: CountersHeldBelowRoomOfViews
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 152 of 152 of 152
// # CHECK-NEXT: exited with 0
function sumByStride(cells: Int32Array, start: number, end: number, stride: number): number { const from = start | 0, to = end | 0, step = (stride | 0) || 1; let sum = 0; for (let i = from; i < to; i += step) sum = (sum + cells[i]! + cells[i + 1]!) | 0; return sum; }
function countAbove(cells: Uint16Array, start: number, end: number, limit: number): number { const from = start | 0, to = end | 0, most = limit | 0; let found = 0; for (let i = from; i < to; i++) if (cells[i]! > most) found++; return found; }
function copyRow(from: Int32Array, to: Int32Array, row: number, width: number): number { const base = (row | 0) * (width | 0) | 0, count = width | 0; for (let x = 0; x < count; x++) to[base + x] = from[base + x]!; return base; }
function dot(left: Float64Array, right: Float64Array, start: number, end: number): number { const from = start | 0, to = end | 0; let sum = 0; for (let i = from; i < to; i++) sum += left[i]! * right[i]!; return sum; }
function lastBelow(cells: Uint8Array, start: number, limit: number): number { const most = limit | 0; let at = start | 0; while (cells[at]! < most) at++; return at; }
function storeThenRead(cells: Int32Array, start: number, end: number): number { const from = start | 0, to = end | 0; let sum = 0; for (let i = from; i < to; i++) { cells[i] = i; sum = (sum + cells[i + 1]!) | 0; } return sum; }
function said(answer: unknown): string { return typeof answer + " " + (Object.is(answer, -0) ? "-0" : String(answer)); }
const ints = new Int32Array(8);
for (let at = 0; at < 8; at++) ints[at] = at + 1;
report(said(sumByStride(ints, 0, 6, 2)));
report(said(sumByStride(ints, 0, 7, 1)));
report(said(sumByStride(ints, 0, 8, 1)));
report(said(sumByStride(ints, 0, 12, 1)));
report(said(sumByStride(ints, -3, 4, 1)));
report(said(sumByStride(ints, -1, 8, 3)));
report(said(sumByStride(ints, 7, 8, 1)));
report(said(sumByStride(ints, 8, 9, 1)));
report(said(sumByStride(ints, 5, 2, 1)));
report(said(sumByStride(new Int32Array(0), 0, 2, 1)));
report(said(sumByStride(ints, 2147483646, 2147483647, 1)));
report(said(sumByStride(ints, -2147483648, -2147483646, 1)));
const shorts = new Uint16Array([5, 70, 3, 900, 65535, 0, 12, 13]);
report(said(countAbove(shorts, 0, 8, 10)));
report(said(countAbove(shorts, 0, 20, 10)));
report(said(countAbove(shorts, -5, 3, 4)));
report(said(countAbove(shorts, 3, 5, -1)));
report(said(countAbove(shorts, 8, 10, -1)));
function copied(source: Int32Array, size: number, row: number, width: number): void { const to = new Int32Array(size).fill(-7); report(said(copyRow(source, to, row, width))); report(to.join(",") + " " + Object.keys(to).length); }
copied(ints, 8, 0, 4);
copied(ints, 8, 1, 4);
copied(ints, 8, 2, 4);
copied(ints, 12, 1, 6);
copied(ints, 12, 2, 4);
copied(ints, 4, 1, 3);
copied(ints, 8, -1, 4);
copied(ints.subarray(2, 5), 8, 0, 6);
const halves = new Float64Array([0.5, 1.5, -2.5, NaN, Infinity, -0, 4, 8]);
const wholes = new Float64Array([2, 2, 2, 2, 0, 2]);
report(said(dot(halves, wholes, 0, 3)));
report(said(dot(halves, wholes, 0, 4)));
report(said(dot(halves, wholes, 4, 5)));
report(said(dot(halves, wholes, 5, 6)));
report(said(dot(halves, wholes, 5, 7)));
report(said(dot(halves, wholes, -1, 2)));
report(said(dot(wholes, halves, 6, 8)));
const bytes = new Uint8Array([1, 2, 3, 4, 200, 1]);
report(said(lastBelow(bytes, 0, 100)));
report(said(lastBelow(bytes, 5, 100)));
report(said(lastBelow(bytes, -1, 100)));
report(said(lastBelow(bytes, 6, 100)));
report(said(storeThenRead(new Int32Array(6).fill(9), 0, 6)));
report(said(storeThenRead(new Int32Array(6).fill(9), -2, 8)));
const tracking = new Int32Array(new ArrayBuffer(16, { maxByteLength: 64 }));
tracking.set([1, 2, 3, 4]);
report(said(sumByStride(tracking, 0, 6, 1)));
(tracking.buffer as any).resize(32);
report(said(sumByStride(tracking, 0, 6, 1)));
(tracking.buffer as any).resize(8);
report(said(sumByStride(tracking, 0, 6, 1)));
(tracking.buffer as any).resize(0);
report(said(sumByStride(tracking, 0, 6, 1)));
const moved = new Int32Array([4, 5, 6, 7]);
structuredClone(moved.buffer, { transfer: [moved.buffer] });
report(said(sumByStride(moved, 0, 3, 1)));
report(said(moved.length));
class Wide extends Int32Array { get length(): number { return 99; } }
report(said(sumByStride(new Wide([1, 2, 3]), 0, 5, 1)));
function sumLoose(cells: Int32Array, start: number, end: number, stride: number): number { let sum = 0; for (let i = start; i < end; i += stride) sum = (sum + cells[i]! + cells[i + 1]!) | 0; return sum; }
function copyLoose(from: Int32Array, to: Int32Array, row: number, width: number): number { const base = row * width; for (let x = 0; x < width; x++) to[base + x] = from[base + x]!; return base; }
function stepsUntil(cells: Int32Array, start: number, end: number, step: number, least: number): number { let sum = 0; for (let i = start; i < end; i += step) { if (i < least) break; sum = (sum + cells[i]!) | 0; } return sum; }
function upToLast(cells: Float64Array, last: number): number { let sum = 0; for (let i = 0; i <= last; i++) sum += cells[i]!; return sum; }
function shiftDown(cells: Int32Array, start: number, end: number): string { for (let i = start; i < end; i++) cells[i] = cells[i + 1]! + 1; return cells.join(","); }
function fillThenSum(cells: Uint8Array, count: number, value: number): number { let sum = 0; for (let i = 0; i < count; i++) { cells[i] = value + i; sum += cells[i]!; } return sum; }
const loose: any = sumLoose;
report(said(sumLoose(ints, 0, 6, 2)));
report(said(sumLoose(ints, 0, 7, 1)));
report(said(sumLoose(ints, 0, 8, 1)));
report(said(sumLoose(ints, -2, 5, 1)));
report(said(sumLoose(ints, 0.5, 4, 1)));
report(said(sumLoose(ints, 0, 4.5, 1)));
report(said(sumLoose(ints, 0, 7, 1.5)));
report(said(sumLoose(ints, 0, NaN, 1)));
report(said(sumLoose(ints, NaN, 4, 1)));
report(said(sumLoose(ints, -0, 3, 1)));
report(said(sumLoose(ints, 0, 3, 4294967296)));
report(said(sumLoose(ints, 4294967296, 4294967298, 1)));
report(said(sumLoose(ints, 2147483646, 2147483649, 1)));
report(said(loose(ints, "1", 4, 1)));
report(said(loose(ints, 1, 4, "1")));
report(said(loose(ints, null, 3, true)));
report(said(loose(ints, { valueOf() { return 2; } }, 5, 1)));
function copiedLoose(source: Int32Array, size: number, row: any, width: any): void { const to = new Int32Array(size).fill(-7); report(said(copyLoose(source, to, row, width))); report(to.join(",") + " " + Object.keys(to).length); }
copiedLoose(ints, 8, 0, 4);
copiedLoose(ints, 8, 1, 4);
copiedLoose(ints, 8, 2, 4);
copiedLoose(ints, 12, 1, 6);
copiedLoose(ints, 4, 1, 3);
copiedLoose(ints, 8, -1, 4);
copiedLoose(ints, 8, 0.5, 4);
copiedLoose(ints, 8, 0.25, 2);
copiedLoose(ints, 8, 1, 2.5);
copiedLoose(ints, 8, 1e9, 4);
copiedLoose(ints, 8, "1", 4);
report(said(stepsUntil(ints, 0, 8, 1, 0)));
report(said(stepsUntil(ints, 6, 8, -1, 2)));
report(said(stepsUntil(ints, 3, 8, -2, -4)));
report(said(stepsUntil(ints, 0, 20, 3, 0)));
report(said(stepsUntil(ints, 7, 8, -1, -3)));
report(said(upToLast(halves, 2)));
report(said(upToLast(halves, 7)));
report(said(upToLast(halves, 8)));
report(said(upToLast(halves, -1)));
report(said(upToLast(wholes, 5)));
report(said(upToLast(wholes, 5.5)));
report(shiftDown(new Int32Array([1, 2, 3, 4]), 0, 3));
report(shiftDown(new Int32Array([1, 2, 3, 4]), 0, 4));
report(shiftDown(new Int32Array([1, 2, 3, 4]), -1, 6));
report(said(fillThenSum(new Uint8Array(4), 4, 250)));
report(said(fillThenSum(new Uint8Array(4), 6, 1)));
report(said(fillThenSum(new Uint8Array(0), 2, 1)));
function storesInHead(cells: Int32Array, count: number): number { const n = count | 0; let sum = 0; for (let i = 0; (cells[0] = i, i < n); i++) sum = (sum + cells[i]!) | 0; return sum; }
function stepsInTheMiddle(cells: Int32Array, count: number): number { const n = count | 0; let sum = 0; for (let i = 0; i < n;) { const first = cells[i]!; i++; sum = (sum + first + cells[i]!) | 0; } return sum; }
function twoCounters(cells: Int32Array, count: number): number { const n = count | 0; let sum = 0; for (let i = 0, j = n - 1; i < n; i++, j--) sum = (sum + cells[i]! * 3 + cells[j]!) | 0; return sum; }
function beginsAnew(cells: Int32Array, count: number): number { const n = count | 0; let sum = 0, again = 2; for (let i = 0; i < n; i++) { sum = (sum + cells[i]!) | 0; if (i === n - 1 && again-- > 0) i = -3; } return sum; }
function skipsAndLeaves(cells: Int32Array, start: number, count: number): number { const from = start | 0, n = count | 0; let sum = 0; for (let i = from; i < n; i++) { if (cells[i]! === 3) continue; if (cells[i + 2]! === 8) break; sum = (sum + cells[i + 1]!) | 0; } return sum; }
function shrinksOnTheWay(cells: Int32Array, count: number, shrink: (at: number) => void): string { const n = count | 0; let said = ""; for (let i = 0; i < n; i++) { said += cells[i] + ","; shrink(i); } return said; }
function counterBehindLoop(cells: Uint8Array, count: number): number { const n = count | 0; let i = 0; for (; i < n; i++) if (cells[i]! > 100) break; return i; }
function innerUnderOuter(cells: Float64Array, rows: number, width: number): number { const high = rows | 0, wide = width | 0; let sum = 0; for (let y = 0; y < high; y++) { sum += cells[y]!; for (let x = 0; x < wide; x++) sum += cells[y + x]!; } return sum; }
report(said(storesInHead(new Int32Array([9, 2, 3]), 3)));
report(said(storesInHead(new Int32Array([9, 2, 3]), 5)));
report(said(stepsInTheMiddle(ints, 7)));
report(said(stepsInTheMiddle(ints, 8)));
report(said(stepsInTheMiddle(ints, 10)));
report(said(twoCounters(ints, 8)));
report(said(twoCounters(ints, 9)));
report(said(twoCounters(ints, 0)));
report(said(beginsAnew(ints, 4)));
report(said(beginsAnew(ints, 8)));
report(said(beginsAnew(ints, 9)));
report(said(skipsAndLeaves(ints, 0, 8)));
report(said(skipsAndLeaves(ints, 6, 12)));
report(said(skipsAndLeaves(ints, -2, 3)));
const shrinking = new Int32Array(new ArrayBuffer(24, { maxByteLength: 64 }));
shrinking.set([1, 2, 3, 4, 5, 6]);
report(shrinksOnTheWay(shrinking, 6, (at) => { if (at === 2) (shrinking.buffer as any).resize(16); }));
report(shrinksOnTheWay(shrinking, 6, (at) => { if (at === 0) (shrinking.buffer as any).resize(48); }));
report(shrinksOnTheWay(shrinking, 3, () => {}));
report(said(counterBehindLoop(bytes, 6)));
report(said(counterBehindLoop(bytes, 3)));
report(said(counterBehindLoop(bytes, 9)));
report(said(counterBehindLoop(new Uint8Array(2), 9)));
report(said(innerUnderOuter(wholes, 2, 3)));
report(said(innerUnderOuter(wholes, 4, 3)));
report(said(innerUnderOuter(wholes, 6, 1)));
report(said(innerUnderOuter(wholes, 7, 0)));
function firstDifference(left: Int32Array, right: Int32Array): number { for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return i; return -1; }
function pairs(keys: Int32Array): number { let sum = 0; for (let at = 0; at < keys.length; at += 2) sum = (sum + keys[at]! * keys[at + 1]!) | 0; return sum; }
function upToItsLength(cells: Int32Array, shrink: (at: number) => void): string { let said = ""; for (let i = 0; i < cells.length; i++) { said += cells[i] + ","; shrink(i); } return said; }
function fillsOther(from: Uint8Array, to: Float64Array): string { for (let i = 0; i < from.length; i++) to[i] = from[i]! / 2; return to.join(","); }
report(said(firstDifference(ints, ints)));
report(said(firstDifference(ints, new Int32Array([1, 2, 3, 9]))));
report(said(firstDifference(ints, new Int32Array([1, 2, 3]))));
report(said(firstDifference(new Int32Array([1, 2, 3]), ints)));
report(said(firstDifference(new Int32Array(0), ints)));
report(said(firstDifference(ints, new Int32Array(0))));
report(said(pairs(ints)));
report(said(pairs(new Int32Array([2, 3, 4]))));
report(said(pairs(new Int32Array([7]))));
report(said(pairs(new Int32Array(0))));
const waning = new Int32Array(new ArrayBuffer(24, { maxByteLength: 64 }));
waning.set([1, 2, 3, 4, 5, 6]);
report(upToItsLength(waning, (at) => { if (at === 1) (waning.buffer as any).resize(12); }));
report(upToItsLength(waning, (at) => { if (at === 1) (waning.buffer as any).resize(20); }));
report(upToItsLength(waning, () => {}));
report(fillsOther(bytes, new Float64Array(6)));
report(fillsOther(bytes, new Float64Array(3)));
report(fillsOther(bytes, new Float64Array(8)));
report(fillsOther(new Uint8Array(0), new Float64Array(2)));
report("end");
declare function report(value: unknown): void;
