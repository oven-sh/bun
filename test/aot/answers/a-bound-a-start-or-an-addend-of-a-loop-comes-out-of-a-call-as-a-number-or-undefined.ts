// answers: without-library
// # `const limit = limitOf(text, at)`, a function that answers a number or undefined: the call's result is held as a double that may be absent. As the bound of a loop's head, as what its counter enters with, as an addend of a key under the counter, it
// # is asked in front of the loop as a box is: for an int32; a bound that is none is asked for a number, rounded, and takes the lesser bound. undefined, NaN, a fraction, Infinity, -1 and numbers on both sides of 2^31 come through each place.
// # f2 = sum, f5 = both, f6 = addend
// # RUN(FORM): walk f2 f5 f6 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM: @OptionalDouble = CallDirect
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: = TypeTest {{*}}testedType=number
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM-LABEL: code f5:Body
// # FORM: @OptionalDouble = CallDirect
// # FORM: @OptionalDouble = CallDirect
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: @Int32{{*}}) isInLoop=true isLoopHead=true
// # FORM-LABEL: code f6:Body
// # FORM: @OptionalDouble = CallDirect
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: @Int32) isInLoop=true isLoopHead=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function limitOf(text: string, at: number): number | undefined { if (at >= text.length) return undefined; const code = text.charCodeAt(at); return code === 46 ? 2.5 : code === 73 ? Infinity : code === 78 ? NaN : code === 45 ? -1 : code === 71 ? 2147483646 : code === 72 ? 2147483649 : code - 48; }
function sum(list: number[], text: string, at: number): string { const limit = limitOf(text, at); let total = 0; let turns = 0; for (let i = 0; i < (limit as number); i++) { total += list[i & 3]!; if (++turns === 6) break; } return total + " in " + turns; }
function upTo(list: number[], text: string, at: number): string { const limit = limitOf(text, at); let total = 0; let turns = 0; for (let i = 0; i <= (limit as number); i++) { total += list[i & 3]!; if (++turns === 6) break; } return total + " in " + turns; }
function from(list: number[], text: string, at: number, to: number): string { const start = limitOf(text, at); let last = -1; let turns = 0; for (let i = start as number; i < to; i++) { last = i + list[i & 3]!; if (++turns === 6) break; } return last + " in " + turns; }
function both(list: number[], text: string, at: number): string { const start = limitOf(text, at); const limit = limitOf(text, at + 1); let last = -1; let turns = 0; for (let i = start as number; i < (limit as number); i++) { last = i + list[i & 3]!; if (++turns === 6) break; } return last + " in " + turns; }
function addend(view: Int32Array, text: string, at: number, count: number): string { const more = limitOf(text, at); let total = 0; for (let i = 0; i < count; i++) total = (total + (view[i + (more as number)] ?? -7)) | 0; return String(total); }
const four = [1, 2, 3, 4];
const view = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]);
const text = JSON.parse('"3.0IN-59GHG2"');
for (let at = 0; at <= text.length + 1; at++) report(at + ": " + sum(four, text, at) + " | " + upTo(four, text, at) + " | " + from(four, text, at, 4) + " | " + from(four, text, at, 2147483650) + " | " + both(four, text, at) + " | " + addend(view, text, at, 4));
report("end");
