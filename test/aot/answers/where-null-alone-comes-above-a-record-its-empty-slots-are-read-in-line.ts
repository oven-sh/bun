// answers: without-library
// # A record that a maker creates below null and fills behind the birth: its fields may be empty, and its prototype changes: to null alone. Nobody answers above it either way,
// # so a slot that may be empty, a store that may create and a name found nowhere are typed as where nothing changes. What is found above (toString) stays guarded.
// # A record filled under keys that nobody knows may get anything above it: Link does not say of it that null alone comes.
// # L0 = table, L1 = N
// # RUN(STAYS): link layouts mechanisms=all
// # STAYS-NOT: filled-under-computed-keys only-null-comes-above
// # STAYS: layout L1 changes=[LosesProperty, ChangesPrototype] stays-with-compiled-code only-null-comes-above
// # RUN(WALK): walk f3 mechanisms=all
// # WALK-NOT: = PropGet
// # WALK: = GetSlotOrUndefined {{*}}key="add"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): any;
declare function opaque(value: unknown): any;
function add(a: number, b: number) { return a + b; }
function scale(a: number, s: number) { return a * s; }
const N: any = Object.create(null);
N.add = add;
N.scale = scale;
function run(n: number) { let s = 0; for (let i = 0; i < n; i++) s += N.add(i, 1) + N.scale(i, 0.5); return s; }
const table: any = { first: 1 };
function fill(keys: string[]) { for (let i = 0; i < keys.length; i++) table[keys[i]] = table.first + i; return Object.keys(table).length; }
function above() { return [typeof N.toString, N.nothing, "add" in N, "toString" in N].join(); }
report(run(100));
report(fill(["a", "b"]));
report(above());
N.later = 5;
report(N.later + Object.keys(N).length);
delete N.scale;
report(typeof N.scale);
report(typeof N.add);
report("end");
