// answers: with-library
// # `to[base + x] = from[base + x]`: the counter is an integer, and of `base` nothing is known but that it comes from in front of the loop. The sum is the key of an element: so `base` is asked for an int32 once,
// # in the row of tests in front of the loop. Where it is one, the key is a sum of integers, the position is held inside the view or the turn begins again in the other copy, and the element goes raw from view to view.
// # Whatever else arrives (a fraction, -0, NaN, an infinity, a number beyond 32 or 53 bits, a text, a bigint, a symbol, an object with a valueOf()) does what the language says.
// # f1 = copyRow, f3 = sumDownFrom, f4 = fillFrom
// # RUN(FORM): walk f1 f3 f4 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: isInLoop=true isLoopHead=true
// # FORM: = Add {{*}}form=Integers
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # FORM: = PutTypedArrayElement {{*}}level=Proven
// # FORM-LABEL: code f3:Body
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: isInLoop=true isLoopHead=true
// # FORM: = Sub {{*}}form=Integers
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # FORM-LABEL: code f4:Body
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: isInLoop=true isLoopHead=true
// # FORM: = Add {{*}}form=Integers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 115 of 115 of 115
// # CHECK-NEXT: exited with 0
function copyRow(from: Int32Array, to: Int32Array, row: number, width: number): number { const base = row * width; for (let x = 0; x < width; x++) to[base + x] = from[base + x]; return base; }
function sumDownFrom(cells: Float64Array, top: number, count: number): number { let sum = 0; for (let i = 0; i < count; i++) sum += cells[top - i]; return sum; }
function fillFrom(list: number[], start: number, count: number, value: number): number { for (let i = 0; i < count; i++) list[start + i] = value; return list.length; }
function said(answer: unknown): string { return typeof answer + " " + (Object.is(answer, -0) ? "-0" : String(answer)); }
const from = new Int32Array(12);
for (let at = 0; at < 12; at++) from[at] = at + 1;
function copied(row: any, width: any): void { const to = new Int32Array(12); try { report(said(copyRow(from, to, row, width))); } catch (e: any) { report(e.name); } report(to.join(",") + " " + Object.keys(to).length); }
copied(0, 4);
copied(1, 4);
copied(2, 4);
copied(3, 4);
copied(2, 5);
copied(-1, 4);
copied(-0, 4);
copied(0, -4);
copied(0.5, 4);
copied(0.5, 3);
copied(0.25, 3);
copied(NaN, 3);
copied(Infinity, 2);
copied(-Infinity, 2);
copied(536870912, 4);
copied(1073741824, 4);
copied(-536870912, 4);
copied(-536870913, 4);
copied(2251799813685248, 4);
copied(4503599627370497, 2);
copied("1", 4);
copied("x", 2);
copied(1, "4");
copied(null, 3);
copied(undefined, 3);
copied(true, 3);
copied(1n, 3);
copied(1n, 3n);
copied({ valueOf() { return 2; } }, 3);
copied({ valueOf() { throw new RangeError("no"); } }, 3);
copied(Symbol.iterator, 3);
const cells = new Float64Array(8);
for (let at = 0; at < 8; at++) cells[at] = at + 0.5;
const tops: any[] = [7, 3, 0, 8, 9, -1, 2.5, -0, NaN, Infinity, 2147483647, 2147483648, -2147483648, "3", null, undefined, 3n, { valueOf() { return 4; } }];
for (const top of tops) { try { report(said(sumDownFrom(cells, top, 3))); } catch (e: any) { report(e.name); } }
const starts: any[] = [0, 2, 5, -1, -0, 0.5, NaN, Infinity, 4294967294, 4294967295, 2147483647, "1", "x", null, undefined, 2n, { toString() { return "k"; } }];
for (const start of starts) { const list = [1, 2, 3]; try { report(said(fillFrom(list, start, 2, 9))); } catch (e: any) { report(e.name); } report(Object.keys(list).join(",") + " " + list.length); }

report("end");
