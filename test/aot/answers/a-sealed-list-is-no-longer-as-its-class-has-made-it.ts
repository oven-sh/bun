// answers: without-library
// # Nothing lays a name on the list or puts another object above it, and it never leaves. But it is sealed: its Structure is another, its elements lie in another storage, and the mark of its cell is gone.
// # So Link no longer says that it stays as its class has made it, and `marks.includes` is asked of the list: a test, the engine's method behind it, the read as written on the failing side.
// # RUN(ASKED): walk f1 mechanisms=all
// # ASKED-LABEL: code f1:Body
// # ASKED: = IsPristine {{*}}builtinClass=Array
// # ASKED: Branch
// # ASKED: inlineBuiltin=ArrayIncludes
// # ASKED: = PropGet {{*}}key="includes"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
const marks: number[] = [3, 1, 4, 1, 5];
Object.seal(marks);
function holds(wanted: number): boolean { return marks.includes(wanted); }
function place(wanted: number): number { return marks.indexOf(wanted); }
for (let round = 0; round < 6; round++) { report(holds(round)); report(place(round)); }
report(marks.length);
report("end");
declare function report(value: unknown): void;
