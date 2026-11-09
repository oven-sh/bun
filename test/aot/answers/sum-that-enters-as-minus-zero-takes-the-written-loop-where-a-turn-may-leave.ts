// answers: without-library
// # a sum of small integers is kept as an integer through the turns laid out: what was added, from 0. A turn that leaves the loop hands the written loop the sum as the entry brought it and what was added since.
// # the first turn has added nothing yet: -0 and nothing is -0, but -0 + 0 is 0. So where a turn may leave, a sum that enters as -0 takes the written loop.
// # where no turn leaves, eight terms at the least have been added to whatever is handed on, and behind the first the language has 0 too: that loop asks nothing more.
// # OPTIONS: check=Validate
// # f2 = left, f3 = returned, f4 = notLeft, f5 = byCounter
// # RUN(LEFT): emit f2 mechanisms=all
// # LEFT: = Const64(-9223372036854775808)
// # RUN(RETURNED): emit f3 mechanisms=all
// # RETURNED: = Const64(-9223372036854775808)
// # eight reads are laid out there all the same
// # RUN(LAID): emit f2 mechanisms=all
// # LAID: = Load8Z({{*}}offset = 7, TypedArrayProperties
// # RUN(NOTLEFT): emit f4 mechanisms=all
// # NOTLEFT: = Load8Z({{*}}offset = 7, TypedArrayProperties
// # RUN(ASKSNOTHING): emit f4 mechanisms=all
// # ASKSNOTHING-NOT: = Const64(-9223372036854775808)
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 47 of 47 of 47
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 47 of 47 of 47
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO2: 47 of 47 of 47
// # ALSO2-NEXT: exited with 0
declare function report(value: unknown): void;
function say(value: number): string { return Object.is(value, -0) ? "-0" : String(value); }
function left(v: Uint8Array, start: number): number { let t = Math.floor(start); for (let i = 0; i < v.length; i++) { if (v[i] === 200) break; t += v[i]; } return t; }
function returned(v: Uint8Array, start: number): number { let t = Math.floor(start); for (let i = 0; i < v.length; i++) { if (v[i] === 200) return t; t += v[i]; } return t; }
function notLeft(v: Uint8Array, start: number): number { let t = Math.floor(start); for (let i = 0; i < v.length; i++) t += v[i] & 1; return t; }
function byCounter(start: number, n: number, stop: number): number { let sum = start * 1; const end = n | 0, halt = stop | 0; for (let i = 0; i < end; i++) { if (i === halt) break; sum += i & 0; } return sum; }
function bytesOf(length: number, at: number): Uint8Array { const v = new Uint8Array(length); for (let i = 0; i < length; i++) v[i] = i === at ? 200 : 0; return v; }
const starts = [-0, 0, 5, -5, 0.5, NaN, -Infinity];
function all(length: number): void { for (let at = -1; at <= length && at < 10; at++) { let said = ""; for (let s = 0; s < starts.length; s++) said += say(left(bytesOf(length, at), starts[s])) + "," + say(returned(bytesOf(length, at), starts[s])) + "," + say(notLeft(bytesOf(length, at), starts[s])) + "," + say(byCounter(starts[s], length, at)) + " "; report(length + " " + at + " " + said); } }
all(0);
all(1);
all(7);
all(8);
all(9);
all(17);
report("end");
