// answers: without-library
// # `for (let i = start; i < end; i += stride)` where Link says of the three `int | fractional`, or `undefined | number`: what enters and the bound were asked for an int32 in front of the loop only where the step is a whole number as written
// # or by the row; a step that may have a fraction made the counter no counter: it stayed a double, each key was a double, each read out of the view `undefined | i32`. The step is asked beside them. Behind the three tests the counter is
// # an int32 that is held where it comes round, and the head asks the lesser of the bound and the room of the views. A fraction, a text, a step below zero, NaN: the other build, from the start.
// # f1 = sumLoose
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 36 of 36 of 36
// # CHECK-NEXT: exited with 0
function sumLoose(cells: Int32Array, start: number, end: number, stride: number): number { let sum = 0; for (let i = start; i < end; i += stride) sum = (sum + cells[i]! + cells[i + 1]!) | 0; return sum; }
function firstDifference(left: Int32Array, right: Int32Array, start?: number, end?: number): number | undefined { for (let i = start; i! < end!; i!++) if (left[i!] !== right[i!]) return i; return end; }
function said(answer: unknown): string { return typeof answer + " " + (Object.is(answer, -0) ? "-0" : String(answer)); }
const ints = new Int32Array(8);
for (let at = 0; at < 8; at++) ints[at] = at + 1;
const loose: any = sumLoose;
report(said(sumLoose(ints, 0, 6, 2)));
report(said(sumLoose(ints, 0, 7, 1)));
report(said(sumLoose(ints, 0, 8, 1)));
report(said(sumLoose(ints, 0, 8, 3)));
report(said(sumLoose(ints, -2, 5, 1)));
report(said(sumLoose(ints, 0.5, 4, 1)));
report(said(sumLoose(ints, 0, 4.5, 1)));
report(said(sumLoose(ints, 0, 7, 1.5)));
report(said(sumLoose(ints, 0, 7, 0.25)));
report(said(sumLoose(ints, 0, NaN, 1)));
report(said(sumLoose(ints, NaN, 4, 1)));
report(said(sumLoose(ints, 0, 4, NaN)));
report(said(sumLoose(ints, 0, 4, Infinity)));
report(said(sumLoose(ints, -0, 3, 1)));
report(said(sumLoose(ints, 0, 3, 4294967296)));
report(said(sumLoose(ints, 0, 3, 2147483647)));
report(said(sumLoose(ints, 2147483640, 2147483647, 2147483647)));
report(said(sumLoose(ints, 4294967296, 4294967298, 1)));
report(said(sumLoose(ints, 2147483646, 2147483649, 1)));
report(said(sumLoose(ints, 5, 2, -1)));
report(said(loose(ints, "1", 4, 1)));
report(said(loose(ints, 1, 4, "1")));
report(said(loose(ints, null, 3, true)));
report(said(loose(ints, { valueOf() { return 2; } }, 5, 1)));
report(said(loose(ints, 0, 5, { valueOf() { return 2; } })));
const other = new Int32Array([1, 2, 3, 9, 5]);
report(said(firstDifference(ints, ints, 0, 8)));
report(said(firstDifference(ints, other, 0, 8)));
report(said(firstDifference(ints, other, 4, 8)));
report(said(firstDifference(other, ints, 4, 5)));
report(said(firstDifference(ints, ints, 0, 12)));
report(said(firstDifference(ints, ints, -2, 3)));
report(said(firstDifference(ints, other, 0.5, 3)));
report(said(firstDifference(ints, other)));
report(said(firstDifference(ints, other, 0)));
report(said(firstDifference(ints, other, undefined, 2)));
report("end");
