// answers: without-library
// # Three views lie side by side on one buffer: what is read or stored one element past the middle one lands in its neighbor, so a room that is too great shows in the answers and does not hide in memory that nobody looks at.
// # The view is the FIRST parameter of each function: its record is the first of the unit. The written addends stand in every order: the greatest first, the greatest last, in the middle; seven accesses in one turn.
// # (The map of the written addends of a view took the key of the unit's first record for an empty bucket: least = greatest = the addend that was written last.)
// # An access in the head of the loop stands in front of the head's test: it is read as it always was.
// # f1 = sumBehind, f2 = layAhead, f3 = sumAhead, f4 = invert
// # RUN(FORM): walk f1 f2 f3 f4 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # FORM-LABEL: code f2:Body
// # FORM: = PutTypedArrayElement {{*}}isInsideView
// # FORM-LABEL: code f3:Body
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # FORM-LABEL: code f4:Body
// # FORM: = PutTypedArrayElement {{*}}isInsideView
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 22 of 22 of 22
// # CHECK-NEXT: exited with 0
function sumBehind(cells: Int32Array, start: number, end: number, stride: number): number { const from = start | 0, to = end | 0, step = (stride | 0) || 1; let sum = 0; for (let i = from; i < to; i += step) sum = (sum + cells[i + 1]! + cells[i]!) | 0; return sum; }
function layAhead(cells: Int32Array, start: number, end: number): number { const from = start | 0, to = end | 0; let sum = 0; for (let i = from; i < to; i++) { cells[i + 1] = 5; sum = (sum + cells[i]!) | 0; } return sum; }
function sumAhead(cells: Int32Array, start: number, end: number, stride: number): number { const from = start | 0, to = end | 0, step = (stride | 0) || 1; let sum = 0; for (let i = from; i < to; i += step) sum = (sum + cells[i]! + cells[i + 1]!) | 0; return sum; }
function invert(pixels: Uint8Array, count: number): number { const n = count | 0; let sum = 0; for (let i = 0; i < n; i += 4) { pixels[i] = 255 - pixels[i]!; pixels[i + 1] = 255 - pixels[i + 1]!; pixels[i + 2] = 255 - pixels[i + 2]!; sum = (sum + pixels[i + 3]!) | 0; } return sum; }
function shift(cells: Int32Array, start: number, end: number): void { const from = start | 0, to = end | 0; for (let i = from; i < to; i++) cells[i] = cells[i + 1]!; }
function products(left: Float64Array, end: number): number { const to = end | 0; let sum = 0; for (let i = 0; i < to; i++) sum += left[i + 1]! * left[i]!; return sum; }
function greatestInTheMiddle(cells: Int32Array, start: number, end: number): number { const from = start | 0, to = end | 0; let sum = 0; for (let i = from; i < to; i++) sum = (sum + cells[i + 1]! + cells[i + 3]! + cells[i + 2]!) | 0; return sum; }
function behindItself(cells: Int32Array, start: number, end: number): number { const from = start | 0, to = end | 0; let sum = 0; for (let i = from; i < to; i++) sum = (sum + cells[i + -1]! + cells[i]!) | 0; return sum; }
function readsInHead(cells: Int32Array, end: number): number { const to = end | 0; let sum = 0, seen = 0; for (let i = 0; (seen = cells[i]! | 0, i < to); i++) sum = (sum + seen + cells[i]!) | 0; return sum + seen; }
function storesInHead(cells: Int32Array, end: number): number { const to = end | 0; let sum = 0; for (let i = 0; (cells[i] = 9, i < to); i++) sum = (sum + cells[i]!) | 0; return sum; }
function secondParameter(spare: number, cells: Int32Array, start: number, end: number): number { const from = start | 0, to = end | 0; let sum = spare | 0; for (let i = from; i < to; i++) sum = (sum + cells[i + 1]! + cells[i]!) | 0; return sum; }
const room = new ArrayBuffer(48);
const front = new Int32Array(room, 0, 4), middle = new Int32Array(room, 16, 4), behind = new Int32Array(room, 32, 4);
function fill(): void { for (let at = 0; at < 4; at++) { front[at] = 1000 + at; middle[at] = at + 1; behind[at] = 7000 + at; } }
function all(): string { return front.join() + " " + middle.join() + " " + behind.join(); }
fill();
report("behind " + sumBehind(middle, 0, 3, 1) + " " + sumBehind(middle, 0, 4, 1) + " " + sumBehind(middle, -1, 2, 1) + " " + sumBehind(middle, 0, 9, 2));
report("lay " + layAhead(middle, 0, 3) + " " + all());
report("lay " + layAhead(middle, 0, 4) + " " + all());
report("lay " + layAhead(middle, -1, 2) + " " + all());
report("lay " + layAhead(middle, -2, 9) + " " + all());
fill();
report("ahead " + sumAhead(middle, 0, 3, 1) + " " + sumAhead(middle, -2, 3, 1) + " " + sumAhead(middle, 0, 9, 1));
report("ahead " + sumAhead(middle, -1, 3, 1));
const picture = new Uint8Array(new ArrayBuffer(32), 8, 16), margin = new Uint8Array(picture.buffer);
for (let at = 0; at < 32; at++) margin[at] = 200 + at;
for (let at = 0; at < 16; at++) picture[at] = at * 3;
report(invert(picture, 16) + " " + margin.join());
report(invert(picture, 20) + " " + margin.join());
report(invert(picture, 13) + " " + margin.join());
fill();
shift(middle, 0, 3); report(all());
shift(middle, 0, 4); report(all());
shift(middle, -1, 5); report(all());
const wide = new ArrayBuffer(64), low = new Float64Array(wide, 0, 4), high = new Float64Array(wide, 32, 4);
for (let at = 0; at < 4; at++) { low[at] = at + 1; high[at] = 1000 + at; }
report(products(low, 3) + " " + products(low, 4) + " " + products(low, 9));
fill();
report("middle " + greatestInTheMiddle(middle, 0, 1) + " " + greatestInTheMiddle(middle, 0, 2) + " " + greatestInTheMiddle(middle, 0, 4) + " " + greatestInTheMiddle(middle, -1, 1) + " " + greatestInTheMiddle(middle, -2, 1));
report("itself " + behindItself(middle, 1, 4) + " " + behindItself(middle, 0, 4) + " " + behindItself(middle, 1, 5) + " " + behindItself(middle, -1, 6));
report("head " + readsInHead(middle, 3) + " " + readsInHead(middle, 4) + " " + readsInHead(middle, 6));
report("head " + storesInHead(middle, 3) + " " + all());
report("head " + storesInHead(middle, 4) + " " + all());
report("head " + storesInHead(middle, 6) + " " + all());
fill();
report("second " + secondParameter(1, middle, 0, 3) + " " + secondParameter(1, middle, 0, 4) + " " + secondParameter(1, middle, -1, 2));
report("end");
declare function report(value: unknown): void;
