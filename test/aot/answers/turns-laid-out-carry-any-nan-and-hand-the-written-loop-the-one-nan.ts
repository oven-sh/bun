// answers: without-library
// # a counted loop over a view of floats has its turns laid out too. What is read out of bytes may be a NaN of any bits, which boxed as it lies would pass for an int32, a cell or another number.
// # in the turns laid out every number that goes from turn to turn takes any NaN: get() tests for whoever asks for the one NaN. Whatever they hand to the written loop, behind the last of them or where a turn leaves, is tested once, there.
// # NaNs of eight kinds of bits stand at every index, and nowhere; what comes out is looked at boxed: its type, its text, whether it is the NaN.
// # OPTIONS: check=Validate
// # f2 = sum, f3 = lastSeen, f4 = firstNaN, f5 = sumOfFloats
// # eight reads laid out and the one of the written loop. The view is made over a buffer, and of such a view Link no longer says that it stays as its class has made it (the buffer might grow): the closed copy of the loop reads its length by name: a tenth
// # RUN(SUM): emit f2 mechanisms=all
// # SUM-LABEL: unit f2:Body
// # SUM-COUNT-10: = Load({{*}}TypedArrayProperties
// # SUM-NOT: = Load({{*}}TypedArrayProperties
// # the sum goes from turn to turn untested
// # RUN(UNTESTED): emit f2 mechanisms=all
// # UNTESTED: = Load({{*}}offset = 8, TypedArrayProperties
// # UNTESTED-NOT: = Branch(
// # UNTESTED-NOT: = Select(
// # UNTESTED: = Load({{*}}offset = 56, TypedArrayProperties
// # RUN(FLOATS): emit f5 mechanisms=all
// # FLOATS: = Load({{*}}offset = 4, TypedArrayProperties
// # FLOATS-NOT: = Branch(
// # FLOATS-NOT: = Select(
// # FLOATS: = Load({{*}}offset = 28, TypedArrayProperties
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 41 of 41 of 41
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 41 of 41 of 41
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO2: 41 of 41 of 41
// # ALSO2-NEXT: exited with 0
declare function report(value: unknown): void;
function look(value: unknown): string { return typeof value + ":" + String(value) + ":" + Object.is(value, NaN); }
function sum(v: Float64Array): number { let t = 0; for (let i = 0; i < v.length; i++) t += v[i]; return t; }
function lastSeen(v: Float64Array): number { let last = 0; for (let i = 0; i < v.length; i++) last = v[i]; return last; }
function firstNaN(v: Float64Array): number { for (let i = 0; i < v.length; i++) { if (v[i] !== v[i]) return v[i]; } return -1; }
function sumOfFloats(v: Float32Array): number { let t = 0; for (let i = 0; i < v.length; i++) t += v[i]; return t; }
const kinds = [0x7ff8000000000000n, 0xfff8000000000000n, 0xfffe000012345678n, 0xffff000000000001n, 0x7ff0000000000001n, 0xffffffffffffffffn, 0xfffc000000001000n, 0xfff9000000000006n];
function once(length: number, at: number, bits: bigint): string { const buffer = new ArrayBuffer(length * 8); const raw = new BigUint64Array(buffer); const view = new Float64Array(buffer); for (let i = 0; i < length; i++) view[i] = (i % 9) - 3.5; if (at >= 0 && at < length) raw[at] = bits; return look(sum(view)) + look(lastSeen(view)) + look(firstNaN(view)); }
function onceOfFloats(length: number, at: number, bits: number): string { const buffer = new ArrayBuffer(length * 4); const raw = new Uint32Array(buffer); const view = new Float32Array(buffer); for (let i = 0; i < length; i++) view[i] = (i % 9) - 3.5; if (at >= 0 && at < length) raw[at] = bits; return look(sumOfFloats(view)); }
function all(length: number): void { for (let at = -1; at < length; at++) { let said = ""; for (let k = 0; k < kinds.length; k++) said += once(length, at, kinds[k]) + " "; report(length + " " + at + " " + said + onceOfFloats(length, at, 0xffc12345) + onceOfFloats(length, at, 0x7f800001)); } }
all(0);
all(1);
all(8);
all(9);
all(17);
report("end");
