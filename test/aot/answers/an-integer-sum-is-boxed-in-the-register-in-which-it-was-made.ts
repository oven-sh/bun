// answers: without-library
// # An integer sum that may leave the int32s is boxed: an add of 32 bits, a jump on overflow, the tag added: ALL IN ONE REGISTER.
// # The low half that the arm that fits boxes is a truncation of that arm's own, which stands in the extension and takes no code. The one in front of the test took a register of its own and a move, on every way:
// # the whole sum lives on beside it, into the arm that overflows.
// # Every pair is run that fits, that overflows upward and downward, and that comes out negative: the upper half of a boxed int32 is the tag and nothing of the sign.
// # f1 = keepSum, f2 = keepDifference
// # REQUIRES(SUM): x86_64
// # RUN(SUM): allocate f1 mechanisms=all
// # SUM-LABEL: unit f1:Body
// # SUM: 32 bits, sets flags
// # SUM-NEXT: Branch no overflow
// # SUM: = ZExt32 Trunc(
// # REQUIRES(DIFFERENCE): x86_64
// # RUN(DIFFERENCE): allocate f2 mechanisms=all
// # DIFFERENCE-LABEL: unit f2:Body
// # DIFFERENCE: 32 bits, sets flags
// # DIFFERENCE-NEXT: Branch no overflow
// # DIFFERENCE: = ZExt32 Trunc(
// # On arm64 the add of the tag extends the low half itself.
// # REQUIRES(ARMSUM): arm64
// # RUN(ARMSUM): allocate f1 mechanisms=all
// # ARMSUM-LABEL: unit f1:Body
// # ARMSUM: 32 bits, sets flags
// # ARMSUM-NEXT: Branch no overflow
// # ARMSUM: = Add ZExt32(Trunc(
// # REQUIRES(ARMDIFFERENCE): arm64
// # RUN(ARMDIFFERENCE): allocate f2 mechanisms=all
// # ARMDIFFERENCE-LABEL: unit f2:Body
// # ARMDIFFERENCE: 32 bits, sets flags
// # ARMDIFFERENCE-NEXT: Branch no overflow
// # ARMDIFFERENCE: = Add ZExt32(Trunc(
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 25 of 25 of 25
// # CHECK-NEXT: exited with 0
let kept: unknown = "nothing yet";
function keepSum(a: number, b: number): void { kept = (a | 0) + (b | 0); }
function keepDifference(a: number, b: number): void { kept = (a | 0) - (b | 0); }
const pairs = [1, 2, -1, -2, 2147483647, 1, -2147483648, -1, 2147483647, 2147483647, -2147483648, -2147483648, 0, 0, -1, 1, -2147483648, 1, 2147483647, -1, 2147483647, -2147483648, 5, -7];
for (let at = 0; at < pairs.length; at += 2) { keepSum(pairs[at], pairs[at + 1]); report(kept as number); keepDifference(pairs[at], pairs[at + 1]); report(kept as number); }
report("end");
declare function report(value: unknown): void;
