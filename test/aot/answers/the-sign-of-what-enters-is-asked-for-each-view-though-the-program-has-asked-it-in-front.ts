// answers: without-library
// # Two and three views under one counter, and the program's own test of the sign in front of the loop: `if (from + shift >= 0) return -1;`. Behind it the answer to "what enters is not below zero" is known on this way: it is false.
// # Each view is refused for that: no store is made at a negative position, and the neighbor on the same buffer keeps what it holds.
// # That the sign was asked counts only behind a test that was built and has passed; a written answer is taken by its value.
// # In `mild` the program's test says that the sign is good: nothing is to be asked, and both views are held.
// # f1 = mild
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = PutTypedArrayElement {{*}}isInsideView
// # FORM: = PutTypedArrayElement {{*}}isInsideView
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 20 of 20 of 20
// # CHECK-NEXT: exited with 0
function mild(first: Int32Array, second: Int32Array, start: number, end: number, move: number): number { const from = start | 0, to = end | 0, shift = move | 0; if (from + shift < 0) return -1; for (let i = from; i < to; i++) { first[i + shift] = 7; second[i + shift] = 7; } return to; }
function lay(first: Int32Array, second: Int32Array, start: number, end: number, move: number): number { const from = start | 0, to = end | 0, shift = move | 0; if (from + shift >= 0) return -1; for (let i = from; i < to; i++) { first[i + shift] = 7; second[i + shift] = 7; } return to; }
function layBare(first: Int32Array, second: Int32Array, start: number, end: number): number { const from = start | 0, to = end | 0; if (from >= 0) return -1; for (let i = from; i < to; i++) { first[i] = 7; second[i] = 7; } return to; }
function layInElse(first: Int32Array, second: Int32Array, start: number, end: number, move: number): number { const from = start | 0, to = end | 0, shift = move | 0; if (from + shift >= 0) { return -1; } else { for (let i = from; i < to; i++) { first[i + shift] = 7; second[i + shift] = 7; } } return to; }
function layOrThrow(first: Int32Array, second: Int32Array, start: number, end: number, move: number): number { const from = start | 0, to = end | 0, shift = move | 0; if (from + shift >= 0) throw new RangeError("no"); for (let i = from; i < to; i++) { first[i + shift] = 7; second[i + shift] = 7; } return to; }
function layThree(first: Int32Array, second: Int32Array, third: Int32Array, start: number, end: number, move: number): number { const from = start | 0, to = end | 0, shift = move | 0; if (from + shift >= 0) return -1; for (let i = from; i < to; i++) { first[i + shift] = 7; second[i + shift] = 7; third[i + shift] = 9; } return to; }
function layDoubles(first: Float64Array, second: Float64Array, start: number, end: number, move: number): number { const from = start | 0, to = end | 0, shift = move | 0; if (from + shift >= 0) return -1; for (let i = from; i < to; i++) { first[i + shift] = 7; second[i + shift] = 7; } return to; }
function sums(first: Int32Array, second: Int32Array, start: number, end: number, move: number): number { const from = start | 0, to = end | 0, shift = move | 0; let seen = 0, total = 0; if (from + shift >= 0) return -1; for (let i = from; i < to; i++) { seen = (seen + first[i + shift]!) | 0; total = (total + second[i + shift]!) | 0; } return total * 100000 + seen; }
function stepAsked(first: Int32Array, second: Int32Array, start: number, end: number, stride: number): number { const from = start | 0, to = end | 0, step = stride | 0; if (step >= 0) return -1; let turns = 0; for (let i = from; i < to; i += step) { first[i] = 7; second[i] = 7; if (++turns > 5) break; } return turns; }
const room = new ArrayBuffer(48);
const front = new Int32Array(room, 0, 4), middle = new Int32Array(room, 16, 4), behind = new Int32Array(room, 32, 4), other = new Int32Array(4);
function fill(): void { for (let at = 0; at < 4; at++) { front[at] = 1000 + at; middle[at] = at + 1; behind[at] = 7000 + at; other[at] = 0; } }
function all(): string { return front.join() + " " + middle.join() + " " + behind.join() + " " + other.join(); }
const given: number[] = JSON.parse("[0, 3, 0, -3, 2, 1, -2, 2]");
fill(); report(mild(other, middle, given[0]!, given[1]!, given[2]!) + " " + all());
fill(); report(mild(other, middle, given[3]!, given[4]!, given[5]!) + " " + all());
fill(); report(mild(other, middle, 1, 9, 1) + " " + all());
fill(); report(lay(other, middle, given[0]!, given[1]!, given[2]!) + " " + all());
fill(); report(lay(other, middle, given[3]!, given[4]!, given[5]!) + " " + all());
fill(); report(lay(middle, other, given[3]!, given[4]!, given[5]!) + " " + all());
fill(); report(layBare(other, middle, given[0]!, given[1]!) + " " + all());
fill(); report(layBare(other, middle, given[6]!, given[7]!) + " " + all());
fill(); report(layInElse(other, middle, given[0]!, given[1]!, given[2]!) + " " + all());
fill(); report(layInElse(other, middle, given[3]!, given[4]!, given[5]!) + " " + all());
fill(); let threw = 0; try { layOrThrow(other, middle, given[0]!, given[1]!, given[2]!); } catch { threw = -1; } report(threw + " " + all());
fill(); report(layOrThrow(other, middle, given[3]!, given[4]!, given[5]!) + " " + all());
fill(); report(layThree(other, middle, behind, given[0]!, given[1]!, given[2]!) + " " + all());
fill(); report(layThree(other, middle, behind, given[3]!, given[4]!, given[5]!) + " " + all());
const wide = new ArrayBuffer(96), low = new Float64Array(wide, 0, 4), mid = new Float64Array(wide, 32, 4), high = new Float64Array(wide, 64, 4), apart = new Float64Array(4);
for (let at = 0; at < 4; at++) { low[at] = 1000 + at; mid[at] = at + 1; high[at] = 7000 + at; }
report(layDoubles(apart, mid, given[0]!, given[1]!, given[2]!) + " " + low.join() + " " + mid.join() + " " + high.join() + " " + apart.join());
report(layDoubles(apart, mid, given[3]!, given[4]!, given[5]!) + " " + low.join() + " " + mid.join() + " " + high.join() + " " + apart.join());
fill(); other.set([10, 20, 30, 40]);
report(sums(other, middle, given[0]!, given[1]!, given[2]!) + " " + sums(other, middle, given[3]!, given[4]!, given[5]!));
fill(); report(stepAsked(other, middle, 2, 4, 1) + " " + all());
fill(); report(stepAsked(other, middle, 2, 4, -1) + " " + all());
report("end");
