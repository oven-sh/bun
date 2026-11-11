// answers: without-library
// # Loops that are built twice for the bound of their counter alone, under bounds of every kind: a fraction, NaN, -0, undefined, texts, null, true, -Infinity; and, from 2147483640 on, 2^31 - 1, 2^31, a fraction above it, Infinity: the last step that is an
// # int32 and the turn that is handed over to the other build. A boxed bound and a number; < and <=; by one and by three; a call in the head in front of the relation, whose calls are counted; a nest; a loop under a handler.
// # f2 = boxed, f5 = top
// # RUN(FORM): walk f2 f5 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM: 2147483647 @Int64 = Integer
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: = TypeTest {{*}}testedType=number
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM: @Int32 = Increment {{*}}form=Integers
// # FORM-LABEL: code f5:Body
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: int[2147483640, 2147483647] @Int32{{*}}) isInLoop=true isLoopHead=true
// # FORM: int[2147483641, 2147483647] @Int32 = Increment {{*}}form=Integers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 19 of 19 of 19
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const view = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]);
let marks = 0;
function mark(): number { marks++; return 0; }
class Row { n: number; constructor(n: number) { this.n = n; } }
function boxed(count: any): number { let total = 0; for (let i = 0; i < count; i++) total = (total + view[i & 7]!) | 0; return total; }
function ofNumber(given: any): number { const count = +given; let total = 0; for (let i = 0; i < count; i++) total = (total + view[i & 7]!) | 0; return total; }
function handled(count: any): number { let total = 0; try { for (let i = 0; i < count; i++) total = (total + view[i & 7]!) | 0; } catch (e) { total = -1; } return total; }
function top(count: any): string { let total = 0, turns = 0, last = 0; for (let i = 2147483640; i < count; i++) { total = (total + view[i & 7]!) | 0; last = i; if (++turns === 20) break; } return total + ":" + turns + ":" + last; }
function topOrEqual(count: any): string { let total = 0, turns = 0, last = 0; for (let i = 2147483640; i <= count; i++) { total = (total + view[i & 7]!) | 0; last = i; if (++turns === 20) break; } return total + ":" + turns + ":" + last; }
function byThree(count: any): string { let total = 0, turns = 0, last = 0; for (let i = 2147483640; i < count; i += 3) { total = (total + view[i & 7]!) | 0; last = i; if (++turns === 5) break; } return total + ":" + turns + ":" + last; }
function marked(count: any): string { marks = 0; let total = 0, turns = 0; for (let i = 2147483640; (mark(), i < count); i++) { total = (total + view[i & 7]!) | 0; if (++turns === 20) break; } return total + ":" + turns + ":" + marks; }
function nest(rows: Row[], count: any): number { let total = 0; for (let r = 0; r < rows.length; r++) { const row = rows[r]!; for (let i = 0; i < count; i++) total = (total + view[(i + row.n) & 7]!) | 0; } return total; }
const zero = JSON.parse("0");
const small: any[] = [3, 2.5, 300.5, zero / zero, JSON.parse("-0"), undefined, "4", "x", null, true, -1 / zero];
const great: any[] = [2147483647, 2147483648, 2147483650.5, 1 / zero, 2147483640, zero / zero];
for (let k = 0; k < small.length; k++) report(k + ": " + boxed(small[k]) + " " + ofNumber(small[k]) + " " + handled(small[k]));
for (let k = 0; k < great.length; k++) report(k + ": " + top(great[k]) + " " + topOrEqual(great[k]) + " " + byThree(great[k]) + " " + marked(great[k]));
report("nest " + nest([new Row(0), new Row(1), new Row(2)], 2.5) + " " + nest([new Row(0), new Row(1), new Row(2)], "2") + " " + nest([new Row(7)], 300.5));
report("end");
