// answers: without-library
// # A loop that nothing else buys: no guess in front, no list, no guard: `for (let i = 0; i < count; i++) total = (total + view[i & 7]) | 0`, count a number: the counter went through a double in every turn, `i & 7` took numbers, the read gave
// # `undefined | i32`. The lesser of the rounded bound and 2^31 - 1 buys the second build by itself: the typed build has an int32 counter; the other build is the plain walk. Views, texts, fields, bits; <= and <; counters from both ends of the int32s.
// # `n > i` and a counter that goes down are not bought: they stay one build.
// # f1 = overView, f4 = bits, f5 = down
// # RUN(FORM): walk f1 f4 f5 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: 2147483647 @Int64 = Integer
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM: @Int32 = Increment {{*}}form=Integers
// # FORM-LABEL: code f4:Body
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: @Int32) isInLoop=true isLoopHead=true
// # FORM: @Int32 = Increment {{*}}form=Integers
// # FORM-LABEL: code f5:Body
// # FORM: isLoopHead=true
// # FORM-NOT: isLoopHead=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 51 of 51 of 51
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Tally { n = 0; add(by: number): void { this.n += by; } }
function overView(view: Int32Array, count: number): string { let total = 0; let turns = 0; for (let i = 0; i < count; i++) { total = (total + view[i & 7]!) | 0; if (++turns === 6) break; } return total + " in " + turns; }
function overText(text: string, count: number): string { let total = 0; let turns = 0; for (let i = 0; i < count; i++) { total += text.charCodeAt(i & 7); if (++turns === 6) break; } return total + " in " + turns; }
function overField(tally: Tally, count: number): string { let turns = 0; for (let i = 0; i <= count; i++) { tally.add(i & 3); if (++turns === 6) break; } return tally.n + " in " + turns; }
function bits(count: number): string { let total = 0; let turns = 0; for (let i = 2147483644; i < count; i++) { total = (total ^ (i << 1)) | 0; if (++turns === 6) break; } return total + " in " + turns; }
function down(count: number): string { let total = 0; let turns = 0; for (let i = -2147483645; i >= count; i--) { total = (total + (i & 3)) | 0; if (++turns === 6) break; } return total + " in " + turns; }
function onLeft(view: Int32Array, count: number): string { let total = 0; let turns = 0; for (let i = 0; count > i; i += 3) { total = (total + view[i & 7]!) | 0; if (++turns === 6) break; } return total + " in " + turns; }
const eight = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]);
const letters = "abcdefgh";
const bounds = [5, 0, -0, -1, 1, 2.5, 0.5, -0.5, NaN, Infinity, -Infinity, 2147483646, 2147483647, 2147483648, 2147483649, 4294967295, 4294967296, 4294967301, 9007199254740991, 9007199254740992, 1e300, -2147483647, -2147483648, -2147483649, -4294967296];
for (let at = 0; at < bounds.length; at++) { const bound = Number(bounds[at]); report(bound + ": " + overView(eight, bound) + " . " + overText(letters, bound) + " . " + overField(new Tally(), bound)); }
for (let at = 0; at < bounds.length; at++) { const bound = Number(bounds[at]); report(bound + ": " + bits(bound) + " . " + down(bound) + " . " + onLeft(eight, bound)); }
report("end");
