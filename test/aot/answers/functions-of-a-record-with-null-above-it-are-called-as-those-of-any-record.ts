// answers: without-library
// # `Object.freeze({ __proto__: null, add, scale })` is how a bundler writes a namespace. Null above a record brings nothing in, so Link opens the layout for nobody:
// # the variable holds the record, its fields hold the functions, and the calls enter them. What null takes away is said: a read that looks above the fields may find nothing.
// # f1 = add, f2 = scale, f3 = run, f4 = textOf, f5 = isGone
// # RUN(STAYS): link layouts mechanisms=all
// # STAYS: layout L0 changes=[IsFrozen, ChangesPrototype] stays-with-compiled-code
// # RUN(FIELDS): link fields mechanisms=all
// # FIELDS: field L0.0 "add" proven=f1 writers-known written-at-construction-alone filled
// # RUN(WALK): walk f3 mechanisms=all
// # WALK-NOT: ResultOfUnknownCallee
// # RUN(GONE): walk f5 mechanisms=all
// # GONE-NOT: = Boolean boolean=false
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): any;
function add(a: number, b: number) { return a + b; }
function scale(a: number, s: number) { return a * s; }
const N: any = Object.freeze({ __proto__: null, add, scale });
function run(n: number) { let s = 0; for (let i = 0; i < n; i++) s += N.add(i, 1) + N.scale(i, 0.5); return s; }
function textOf() { return N.toString; }
function isGone() { return textOf() === undefined; }
report(run(100));
report(isGone());
report(typeof textOf());
report("toString" in N);
report("end");
