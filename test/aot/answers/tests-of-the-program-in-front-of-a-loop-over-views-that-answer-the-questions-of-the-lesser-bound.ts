// answers: without-library
// # In front of a loop over views the compiler asks: is what enters, with the least addend, not below zero; is the step not below zero; which of two rooms is the lesser; is the bound below the least room. Where the program has asked the same in front of the loop the answer is known
// # on that way, and the operation comes back as a written true or false in the place of a test. Each question here is answered by the program both ways, for one, two and three views, with shifts of both signs, as first and as later parameters.
// # Views lie side by side on one buffer: what is read or stored past one of them shows in its neighbor.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 251 of 251 of 251
// # CHECK-NEXT: exited with 0
function signGood(first: Int32Array, second: Int32Array, start: number, end: number, move: number): number { const from = start | 0, to = end | 0, shift = move | 0; if (from + shift < 0) return -1; for (let i = from; i < to; i++) { first[i + shift] = 7; second[i + shift] = 8; } return to; }
function signBad(first: Int32Array, second: Int32Array, start: number, end: number, move: number): number { const from = start | 0, to = end | 0, shift = move | 0; if (from + shift >= 0) return -1; for (let i = from; i < to; i++) { first[i + shift] = 7; second[i + shift] = 8; } return to; }
function signBadThree(spare: number, first: Int32Array, second: Int32Array, third: Int32Array, start: number, end: number, move: number): number { const from = start | 0, to = end | 0, shift = move | 0; if (from + shift >= 0) return spare; for (let i = from; i < to; i++) { first[i + shift] = 7; second[i + shift] = 8; third[i + shift] = 9; } return to; }
function boundBelowRoom(first: Int32Array, second: Int32Array, end: number): number { const to = end | 0; if (!(to < first.length)) return -1; let sum = 0; for (let i = 0; i < to; i++) { second[i] = first[i]! + 1; sum = (sum + second[i]!) | 0; } return sum; }
function boundPastRoom(first: Int32Array, second: Int32Array, end: number): number { const to = end | 0; if (to < first.length) return -1; let sum = 0; for (let i = 0; i < to; i++) { second[i] = 5; sum = (sum + (first[i]! | 0)) | 0; } return sum; }
function firstIsShorter(first: Int32Array, second: Int32Array, end: number): number { const to = end | 0; if (!(first.length < second.length)) return -1; for (let i = 0; i < to; i++) { first[i] = 7; second[i] = 8; } return to; }
function secondIsShorter(first: Int32Array, second: Int32Array, end: number): number { const to = end | 0; if (first.length < second.length) return -1; for (let i = 0; i < to; i++) { first[i] = 7; second[i] = 8; } return to; }
function secondIsShorterAskedTheOtherWay(first: Int32Array, second: Int32Array, end: number): number { const to = end | 0; if (!(second.length < first.length)) return -1; for (let i = 0; i < to; i++) { first[i] = 7; second[i] = 8; } return to; }
function stepGood(first: Int32Array, second: Int32Array, start: number, end: number, stride: number): number { const from = start | 0, to = end | 0, step = stride | 0; if (step < 0) return -1; let turns = 0; for (let i = from; i < to; i += step) { first[i] = 7; second[i] = 8; if (++turns > 5) break; } return turns; }
function stepBad(first: Int32Array, second: Int32Array, start: number, end: number, stride: number): number { const from = start | 0, to = end | 0, step = stride | 0; if (step >= 0) return -1; let turns = 0; for (let i = from; i < to; i += step) { first[i] = 7; second[i] = 8; if (++turns > 5) break; } return turns; }
function entersBad(first: Int32Array, second: Int32Array, start: number, end: number): number { const from = start | 0, to = end | 0; if (from >= 0) return -1; let sum = 0; for (let i = from; i < to; i++) { sum = (sum + (first[i]! | 0) + (second[i + 1]! | 0)) | 0; second[i] = 8; } return sum; }
const room = new ArrayBuffer(64);
const front = new Int32Array(room, 0, 4), middle = new Int32Array(room, 16, 4), behind = new Int32Array(room, 32, 4), last = new Int32Array(room, 48, 4), short = new Int32Array(room, 16, 2);
function fill(): void { for (let at = 0; at < 4; at++) { front[at] = 1000 + at; middle[at] = at + 1; behind[at] = 7000 + at; last[at] = 9000 + at; } }
function all(): string { return front.join() + " " + middle.join() + " " + behind.join() + " " + last.join(); }
function tried(what: string, answer: number): void { report(what + " " + answer + " " + all()); fill(); }
fill();
const moves: number[] = JSON.parse("[0, 1, 2, -1, -2, -4]"), starts: number[] = JSON.parse("[0, 2, -1, -3, 5]"), ends: number[] = JSON.parse("[0, 2, 3, 4, 5, 6, -1]"), strides: number[] = JSON.parse("[0, 1, 2, -1, -2]"), entering: number[] = JSON.parse("[0, -1, -2, -5]");
function signs(start: number, move: number): void { tried("good " + start + " " + move, signGood(middle, behind, start, start + 3, move)); tried("good' " + start + " " + move, signGood(behind, middle, start, start + 3, move)); tried("bad " + start + " " + move, signBad(middle, behind, start, start + 3, move)); tried("bad' " + start + " " + move, signBad(behind, middle, start, start + 3, move)); tried("three " + start + " " + move, signBadThree(-1, behind, middle, last, start, start + 4, move)); }
function bounds(end: number): void { tried("below " + end, boundBelowRoom(middle, behind, end)); tried("below short " + end, boundBelowRoom(middle, short, end)); tried("below from short " + end, boundBelowRoom(short, behind, end)); tried("past " + end, boundPastRoom(middle, behind, end)); tried("past short " + end, boundPastRoom(short, behind, end)); }
function rooms(end: number): void { tried("shorter first " + end, firstIsShorter(short, behind, end)); tried("shorter first, not " + end, firstIsShorter(behind, short, end)); tried("shorter second " + end, secondIsShorter(behind, short, end)); tried("shorter second, level " + end, secondIsShorter(behind, last, end)); tried("the other way " + end, secondIsShorterAskedTheOtherWay(behind, short, end)); tried("the other way, not " + end, secondIsShorterAskedTheOtherWay(short, behind, end)); }
function steps(stride: number): void { tried("step good " + stride, stepGood(middle, behind, 1, 4, stride)); tried("step bad " + stride, stepBad(middle, behind, 1, 4, stride)); tried("step bad' " + stride, stepBad(behind, middle, 2, 3, stride)); }
function enters(start: number): void { tried("enters " + start, entersBad(middle, behind, start, 2)); tried("enters' " + start, entersBad(behind, middle, start, 5)); }
for (let a = 0; a < moves.length; a++) for (let b = 0; b < starts.length; b++) signs(starts[b]!, moves[a]!);
for (let a = 0; a < ends.length; a++) { bounds(ends[a]!); rooms(ends[a]!); }
for (let a = 0; a < strides.length; a++) steps(strides[a]!);
for (let a = 0; a < entering.length; a++) enters(entering[a]!);
report("end");
declare function report(value: unknown): void;
