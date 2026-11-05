// answers: without-library
// # `while (index < end) { .. index++; }`, with nothing known of the position or the end: what enters the head for the counter, and the bound, are asked for an int32 once, in front of the loop.
// # Where both are, the turns compare and step integers. Whatever else arrives (a text, a fraction, a bigint, a symbol, an object with a valueOf(), a counter that outgrows 32 bits) does what the language says.
// # f1 = skip, f2 = trim, f3 = sum, f4 = tell
// # RUN(FORM): walk f1 f2 f3 mechanisms=all-Inlining
// # FORM-LABEL: code f1:Body
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: frequency=Rare isLoopHead=true
// # FORM: = Less {{*}}form=Generic
// # FORM: = Increment {{*}}form=Generic
// # FORM: isInLoop=true isLoopHead=true
// # FORM: = Less {{*}}form=Integers
// # FORM: = Increment {{*}}form=Integers
// # FORM-LABEL: code f2:Body
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: isInLoop=true isLoopHead=true
// # FORM: = Greater {{*}}form=Integers
// # FORM: = Decrement {{*}}form=Integers
// # FORM-LABEL: code f3:Body
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: isInLoop=true isLoopHead=true
// # FORM: = Less {{*}}form=Integers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 59 of 59 of 59
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO1: 59 of 59 of 59
// # ALSO1-NEXT: exited with 0
function skip(text, index, end, stop) { while (index < end) { const code = text.charCodeAt(index); if (code === 59 || code === stop) break; index++; } return index; }
function trim(text, start, end) { while (end > start) { const code = text.charCodeAt(end - 1); if (code !== 32 && code !== 9) break; end--; } return end; }
function sum(list, from, to) { let total = 0; for (let i = from; i < to; i += 2) total += list[i]; return total; }
function tell(f) { try { const answer = f(); report(typeof answer + " " + String(answer)); } catch (e) { report(e.name); } }
let conversions = 0;
const counted = { valueOf() { conversions++; return 0; } };
tell(() => skip("text/html; charset=utf-8", 0, 24, 65536));
tell(() => skip("text/html; charset=utf-8", 10, 24, 61));
tell(() => skip("abc", 3, 3, 0));
tell(() => skip("abc", 5, 3, 0));
tell(() => skip("abc", -2, 2, 0));
tell(() => skip("abc", "1", 3, 0));
tell(() => skip("abc", "x", 3, 0));
tell(() => skip("abc", 0.5, 3, 0));
tell(() => skip("abc", -0, 1, 0));
tell(() => skip("abc", 1, "3", 0));
tell(() => skip("abc", "1", "3", 0));
tell(() => skip("abc", "10", "9", 0));
tell(() => skip("abc", 1, 2.5, 0));
tell(() => skip("abc", 0, NaN, 0));
tell(() => skip("abc", 0, Infinity, 99));
tell(() => skip("abc", 2147483646, 2147483647, 0));
tell(() => skip("abc", 2147483646, 2147483649, 0));
tell(() => skip("abc", 2147483647, 2147483650, 0));
tell(() => skip("abc", -2147483648, -2147483646, 0));
tell(() => skip("abc", undefined, 3, 0));
tell(() => skip("abc", null, 3, 0));
tell(() => skip("abc", true, 3, 0));
tell(() => skip("abc", 0, undefined, 0));
tell(() => skip("abc", 0, null, 0));
tell(() => skip("abc", 0, true, 0));
tell(() => skip("abc", 3n, 1n, 0));
tell(() => skip("abc", 1n, 3n, 0));
tell(() => skip("abc", 1n, 3, 0));
tell(() => skip("abc", 1, 3n, 0));
tell(() => skip("abc", Symbol.iterator, 3, 0));
tell(() => skip("abc", 0, Symbol.iterator, 0));
tell(() => skip("abc", { valueOf() { return 1; } }, 3, 0));
tell(() => skip("abc", 0, { valueOf() { return 2; } }, 0));
tell(() => skip("abc", { valueOf() { throw new RangeError("no"); } }, 3, 0));
tell(() => skip("ab;", counted, 3, 0));
tell(() => conversions);
tell(() => skip("ab;", 0, counted, 0));
tell(() => conversions);
tell(() => skip(null, 0, 0, 0));
tell(() => skip(null, 0, 1, 0));
tell(() => trim("text/html\t \t", 0, 12));
tell(() => trim("\t \t ", 0, 4));
tell(() => trim("ab\t ", 0, "4"));
tell(() => trim("ab\t ", "1", 4));
tell(() => trim("ab\t ", 0, 3.5));
tell(() => trim("ab\t ", -2147483648, -2147483648));
tell(() => trim("ab\t ", -2147483650, -2147483647));
tell(() => trim("ab\t ", undefined, 4));
tell(() => trim("ab\t ", 0, 4n));
tell(() => trim("ab\t ", 0n, 4n));
tell(() => sum([1, 2, 3, 4, 5, 6], 0, 6));
tell(() => sum([1, 2, 3, 4, 5, 6], 1, 6));
tell(() => sum([1, 2, 3, 4, 5, 6], "0", 6));
tell(() => sum([1, 2, 3, 4, 5, 6], 0.5, 3));
tell(() => sum([1, 2, 3, 4, 5, 6], 4, 9));
tell(() => sum([1, 2, 3, 4, 5, 6], 2147483645, 2147483650));
tell(() => sum([1, 2, 3, 4, 5, 6], null, 4));
tell(() => sum([1, 2, 3, 4, 5, 6], 0n, 4n));
report("end");
