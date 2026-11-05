// answers: without-library
// # user() makes an arrow for its call of relay() alone, and the copy of relay() hands it on twice in one call: countApart() holds the two against each other and lays both into a Set.
// # One evaluation of a function expression gives one object, whoever takes it and however often.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
const seen = new Set<unknown>();
function countApart(first: unknown, second: unknown) { let sum = 0; for (let turn = 0; turn < 3; turn++) sum += turn; seen.clear(); seen.add(first); seen.add(second); return seen.size * 10 + (first === second ? 1 : 0) + sum; }
function relay(work: () => number, open: boolean) { if (!open) return 0; return countApart(work, work); }
function user(round: number) { let total = 0; for (let at = 0; at < 6; at++) total += relay(() => at + round, at % 3 !== 0); return total; }
for (let round = 0; round < 3; round++) report(user(round));
report("end");
