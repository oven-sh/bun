// answers: without-library
// # the counter of a loop whose turns are laid out is held against its bound by < <= > or >= and stepped towards it by a constant, up or down. The tests of the turns hold one after the other as far as the last of them does,
// # so the counter is held against the bound less what the seven turns behind the first step it by. Every number of turns from 0 past four times eight, the ends of int32, where that difference wraps, and more than a stretch.
// # OPTIONS: check=Validate
// # f1 = everySecond, f2 = fromTheEnd, f3 = lastSpace, f4 = upTo, f5 = downTo, f6 = bySeventeen
// # by two: the counter of a later turn is that of the first and twice as much
// # RUN(TWO): emit f1 mechanisms=all
// # TWO-LABEL: unit f1:Body
// # TWO: = Load8Z({{*}}offset = 2, TypedArrayProperties
// # TWO: = Load8Z({{*}}offset = 14, TypedArrayProperties
// # down by one
// # RUN(DOWN): emit f2 mechanisms=all
// # DOWN: = Load8Z({{*}}offset = -1, TypedArrayProperties
// # DOWN: = Load8Z({{*}}offset = -7, TypedArrayProperties
// # a search from the end: eight reads laid out and the one of the written loop
// # RUN(LAST): emit f3 mechanisms=all
// # LAST-COUNT-9: = Load8Z({{*}}characters8
// # LAST-NOT: = Load8Z({{*}}characters8
// # a counter that is kept in 64 bits and stepped in 32: what widens and narrows it hands the integer on. Nine turns, two multiplications each
// # RUN(WIDE): emit f4 mechanisms=all
// # WIDE-COUNT-18: = Mul(
// # WIDE-NOT: = Mul(
// # RUN(ABOVE): emit f5 mechanisms=all
// # ABOVE-COUNT-18: = Mul(
// # ABOVE-NOT: = Mul(
// # a step of more than sixteen stays as it is written
// # RUN(FAR): emit f6 mechanisms=all
// # FAR-COUNT-2: = Mul(
// # FAR-NOT: = Mul(
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 39 of 39 of 39
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 39 of 39 of 39
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO2: 39 of 39 of 39
// # ALSO2-NEXT: exited with 0
declare function report(value: unknown): void;
function everySecond(v: Uint8Array): number { let t = 0; for (let i = 0; i < v.length; i += 2) t += v[i]; return t; }
function fromTheEnd(v: Uint8Array): number { let h = 7; for (let i = v.length - 1; i >= 0; i--) h = (h * 31 + v[i]) | 0; return h; }
function lastSpace(s: string): number { for (let i = s.length - 1; i >= 0; i--) { if (s.charCodeAt(i) === 32) return i; } return -1; }
function upTo(from: number, to: number): number { let h = 7; for (let i = from | 0; i <= (to | 0); i += 3) h = (h * 31 + i) | 0; return h; }
function downTo(from: number, to: number): number { let h = 7; for (let i = from | 0; i > (to | 0); i -= 2) h = (h * 31 + i) | 0; return h; }
function bySeventeen(from: number, to: number): number { let h = 7; for (let i = from | 0; i < (to | 0); i += 17) h = (h * 31 + i) | 0; return h; }
function bytesOf(length: number): Uint8Array { const view = new Uint8Array(length); for (let i = 0; i < length; i++) view[i] = i * 37 + 11; return view; }
function textOf(length: number, at: number): string { let text = ""; for (let i = 0; i < length; i++) text += i === at ? " " : "a"; return text; }
function all(length: number): void { let found = ""; for (let at = -1; at <= length; at++) found += lastSpace(textOf(length, at)) + ","; report([length, everySecond(bytesOf(length)), fromTheEnd(bytesOf(length)), found, upTo(5, 5 + length), upTo(-length, length), downTo(length, -length), downTo(5 + length, 5), bySeventeen(0, length * 17)].join(" ")); }
for (let length = 0; length < 36; length++) all(length);
report([upTo(2147483000, 2147483640), upTo(-2147483648, -2147483648), upTo(-2147483648, -2147483630), downTo(-2147483000, -2147483640), downTo(2147483647, 2147483647), downTo(2147483647, 2147483630)].join(" "));
report([upTo(0, 3200000), downTo(2200000, -7), everySecond(bytesOf(2100003)), fromTheEnd(bytesOf(1048590))].join(" "));
report("end");
