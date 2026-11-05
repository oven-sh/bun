// answers: without-library
// # The word of Link that a table stays as made is held against the table where it is taken. The test asks one bit of the cell, for a table and a view as for a list, and the cell alone: in a test run too, where a member above may have been replaced and put back.
// # A check that has passed is remembered until code that nobody sees can run: two uses in a row, one check; behind the call of report() the table is asked anew.
// # f1 = twice, f2 = lengthOf
// # RUN(ONCE): walk f1 mechanisms=all
// # ONCE-COUNT-2: = IsPristine {{*}}builtinClass=Map aspects=[Names, CellAlone]
// # ONCE-NOT: = IsPristine
// # RUN(HELD): walk f1 mechanisms=all
// # HELD: CheckProof {{*}}checkedType=true
// # HELD-COUNT-3: inlineBuiltin=MapGet
// # RUN(VIEW): walk f2 mechanisms=all
// # VIEW: = IsPristine {{*}}builtinClass=Uint8Array aspects=[Names, CellAlone]
// # VIEW: CheckProof {{*}}checkedType=true
// # VIEW: = GetTypedArrayLength
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
function twice(table: Map<string, number>, name: string): number { const before = (table.get(name) ?? 0) + (table.get(name) ?? 0); report(before); return before + (table.get(name) ?? 0); }
function lengthOf(view: Uint8Array): number { return view.length; }
report(twice(new Map([["a", 2]]), "a"));
report(lengthOf(new Uint8Array(3)));
report("end");
