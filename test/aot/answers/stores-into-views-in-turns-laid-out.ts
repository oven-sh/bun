// answers: without-library
// # a turn of a counted loop that stores a number into a view is laid out eight at a time like one that only reads.
// # a turn laid out that leaves is taken again by the written loop from its start, so nobody may see that it was begun twice: behind a store no edge leaves the turn. The store stands in the block that leads back to the head.
// # two views of one buffer, one element apart: each turn reads what the turn before has stored through the other view.
// # OPTIONS: check=Validate
// # f1 = triple, f2 = bumpUntil, f3 = shifted, f4 = halved
// # RUN(TRIPLE): emit f1 mechanisms=all
// # TRIPLE: = Store({{*}}offset = 28, TypedArrayProperties
// # behind its store this turn may leave: begun again it would add one twice. It stays as it is written.
// # RUN(UNTIL): emit f2 mechanisms=all
// # UNTIL: = Store({{*}}offset = 0, TypedArrayProperties
// # RUN(WRITTEN): emit f2 mechanisms=all
// # WRITTEN-NOT: = Store({{*}}offset = 4, TypedArrayProperties
// # RUN(SHIFTED): emit f3 mechanisms=all
// # SHIFTED: = Store({{*}}offset = 28, TypedArrayProperties
// # RUN(HALVED): emit f4 mechanisms=all
// # HALVED: = Store({{*}}offset = 56, TypedArrayProperties
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 44 of 44 of 44
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 44 of 44 of 44
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO2: 44 of 44 of 44
// # ALSO2-NEXT: exited with 0
declare function report(value: unknown): void;
function triple(view: Int32Array): void { for (let i = 0; i < view.length; i++) view[i] = view[i] * 3 + 1; }
function bumpUntil(view: Int32Array, stop: number): number { let i = 0; for (; i < view.length; i++) { view[i] = view[i] + 1; if (view[i] === stop) break; } return i; }
function shifted(from: Int32Array, into: Int32Array): void { for (let i = 0; i < from.length; i++) into[i] = from[i] + 1; }
function halved(view: Float64Array, from: number): void { for (let i = 0; i < view.length; i++) view[i] = from * 0.5 + i; }
function show(view: Int32Array): string { let said = ""; for (let i = 0; i < view.length; i++) said += view[i] + ","; return said; }
function showNumbers(view: Float64Array): string { let said = ""; for (let i = 0; i < view.length; i++) said += view[i] + ","; return said; }
function made(length: number): Int32Array { const view = new Int32Array(length); for (let i = 0; i < length; i++) view[i] = i * 3; return view; }
function tripled(length: number): void { const view = made(length); triple(view); triple(view); report(show(view)); }
function left(length: number, place: number): void { const view = made(length); report(bumpUntil(view, place * 3 + 1)); report(show(view)); report(bumpUntil(view, -1)); report(show(view)); }
function chained(length: number): void { const buffer = new ArrayBuffer((length + 1) * 4); const from = new Int32Array(buffer, 0, length); const into = new Int32Array(buffer, 4, length); from[0] = 5; shifted(from, into); shifted(from, into); report(show(new Int32Array(buffer))); }
function numbers(length: number): void { const view = new Float64Array(length); halved(view, 3); report(showNumbers(view)); halved(view, NaN); report(showNumbers(view)); }
tripled(0);
tripled(7);
tripled(8);
tripled(9);
tripled(17);
chained(1);
chained(8);
chained(9);
chained(24);
numbers(7);
numbers(8);
numbers(17);
left(24, 0);
left(24, 1);
left(24, 7);
left(24, 8);
left(24, 15);
left(24, 16);
left(24, 23);
report("end");
