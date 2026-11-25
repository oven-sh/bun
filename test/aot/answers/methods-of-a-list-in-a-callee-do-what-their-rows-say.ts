// answers: without-library
// # a callee calls push and pop on a list that its caller has made and nobody else has: the row that a list as its class makes it takes says what the call does, and the row for whatever is like a list is not asked
// # f1 = add, f2 = take
// # Since Link's effects lean on no site of a list that comes through a parameter, add() and take() are any code to their callers; the answers are what is held.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function add(list: number[], x: number) { list.push(x); }
function take(list: number[]) { return list.pop(); }
function fill(box: { n: number }) { const list: number[] = []; const before = box.n; add(list, 4); add(list, 5); const last = take(list); return before * 100 + box.n * 10 + (last as number); }
function inLoop(box: { n: number }) { const list: number[] = []; let s = 0; for (let i = 0; i < 3; i++) { add(list, i); s = s * 10 + box.n; } return s * 10 + (take(list) as number); }
report(fill({ n: 1 }));
report(inLoop({ n: 2 }));
report("end");
