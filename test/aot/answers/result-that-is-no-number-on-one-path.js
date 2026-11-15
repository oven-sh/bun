// answers: without-library
// # If the form of a result went by the paths that return numbers alone, undefined at the end of the body, null, a text, a boolean beside numbers, a hole of a list or a field that is not there would be read as a number.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 334 of 334 of 334
// # CHECK-NEXT: exited with 0
// # With no callee copied into its caller every call is a call, of the smallest function too.
// # RUN(CALLED): run-in-shell mechanisms=-Inlining $SHELL
// # CALLED: 334 of 334 of 334
// # CALLED-NEXT: exited with 0
function told(n) { report(n); report(n + 1); report(n * 2); report(n > 0); report(n === n); report(n === undefined); report(n === null); report("" + n); report(typeof n); }
function found(list, wanted) { for (let i = 0; i < 3; i++) { if (list[i] === wanted) return i; } }
function positive(n) { if (n > 0) return n; }
function orNull(n) { return n > 0 ? n : null; }
function orText(n) { return n > 0 ? n : "none"; }
function orFlag(n) { return n > 0 ? n : false; }
function flagOrNothing(n) { if (n > 0) return true; }
function flagOrNumber(n) { return n > 0 ? true : n; }
function same(value) { return value; }
function sum(a, b) { return a + b; }
function first(list) { return list[0]; }
function field(holder) { return holder.value; }
function throughSame(value) { return same(value); }
function counted(n) { let last; for (let i = 0; i < n; i++) { last = i; } return last; }
function caught(n) { try { if (n > 1) throw n; return n; } catch (error) { return "" + error; } }
told(found([5, 6, 7], 6));
told(found([5, 6, 7], 8));
told(positive(3));
told(positive(-3));
told(orNull(2.5));
told(orNull(-2.5));
told(orText(4));
told(orText(0));
told(orFlag(4));
told(orFlag(0));
told(flagOrNothing(1));
told(flagOrNothing(0));
told(flagOrNumber(1));
told(flagOrNumber(-1.5));
told(same(1));
told(same(2.5));
told(same(3));
told(same("late"));
told(same(4));
told(sum(1, 2));
told(sum(1.5, 2));
told(sum("1", 2));
told(sum(1, 2));
told(first([1]));
told(first([1.5]));
told(first([]));
told(first(["x"]));
told(field({ value: 1 }));
told(field({ value: 2.5 }));
told(field({ other: 1 }));
told(field({ value: null }));
told(throughSame(1));
told(throughSame(undefined));
told(counted(3));
told(counted(0));
told(caught(1));
told(caught(2));
report("end");
