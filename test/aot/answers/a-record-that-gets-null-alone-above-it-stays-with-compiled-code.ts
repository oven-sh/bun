// answers: without-library
// # A literal that writes `__proto__: null`, and a record that Object.setPrototypeOf() cuts off: nobody stands above them, so no accessor gets hold of them and no name comes in.
// # Link says that the prototype changes and no more: the fields hold what is stored.
// # A record that gets an object above it goes to unseen code as ever, and so does a record that gets whatever a variable holds.
// # f1 = make, f2 = sum, f3 = cut, f4 = below, f5 = under
// # L0 = under's literal, L1 = below's, L3 = make's, L4 = cut's
// # RUN(STAYS): link layouts mechanisms=all
// # STAYS: layout L0 changes=[IsFrozen, GainsProperty, LosesProperty, ChangesPrototype, GetsAccessor]
// # STAYS: layout L1 changes=[IsFrozen, GainsProperty, LosesProperty, ChangesPrototype, GetsAccessor]
// # STAYS: layout L3 changes=[ChangesPrototype] stays-with-compiled-code
// # STAYS: layout L4 changes=[ChangesPrototype] stays-with-compiled-code
// # RUN(FIELDS): link fields mechanisms=all
// # FIELDS: field L3.0 "id" proven=int[0, 9007199254740992] writers-known written-at-construction-alone filled
// # FIELDS: field L4.1 "cutName" proven=string writers-known written-at-construction-alone filled
// # RUN(WALK): walk f2 mechanisms=all
// # WALK-NOT: form=Generic
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): any;
function make(i: number) { return { __proto__: null, id: i, x: i * 2, y: i * 3 }; }
function sum(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = make(i); s += r.id + r.x + r.y; } return s; }
function cut(i: number) { const r: any = { cutId: i, cutName: "c" }; Object.setPrototypeOf(r, null); return r.cutId + r.cutName + typeof r.toString; }
function below(i: number) { const r: any = { belowId: i, belowName: "b" }; Object.setPrototypeOf(r, { get up() { return (this as any).belowId + 1; } }); return r.up + r.belowName + typeof r.toString; }
function under(i: number, above: any) { const r: any = { __proto__: above, underId: i, underName: "u" }; return r.underId + r.underName + typeof r.toString; }
report(sum(100));
report(cut(1));
report(below(2));
report(under(3, null));
report(under(4, { toString: 5 }));
report("end");
