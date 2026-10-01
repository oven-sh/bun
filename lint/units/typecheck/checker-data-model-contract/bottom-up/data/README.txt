slicewrites.tsv        goanal slicewrites checker: every slice that package checker writes in place (70), with the places where the same
                       slice escaped before the last write. Columns: function position, function, class, kind, name, Go type, writes, escapes.
                       Classes: local-buffer 46, param 9, stored-slice 10, escape-then-write 5. Read by hand: two slices are written after
                       another holder got them (fillMissingTypeArguments.result, the inferences of an inference context).
same.tsv               goanal same checker: the 14 calls of core.Same on 13 lines with both arguments.
funcvalues.tsv         goanal funcvalues checker: function values that are stored in a field, a literal or returned (130).
loops.tsv              goanal loops checker binder: the 89 for statements without a counter.
loops-with-budget.tsv  the five of them whose end depends on checker state (by hand).
structs.tsv            goanal structs checker: the 149 struct types of the package with their fields.
checker-fields.tsv     py/genchecker.py: the 319 fields of upstream's Checker with the Rust field and type, or the reason for no field.
functions-by-layer.tsv py/settle.py: one layer and one landing step for each of the 3,060 functions of internal/checker and internal/binder.
port-status-rows.tsv   py/settle.py: the rows of PORT_STATUS.md for internal/checker and internal/binder: one row for each run of functions of one layer in one upstream file.
layer-settlement.tsv   py/settle.py: the ranges that two layer tables claim, the function no table lists, the pull-forwards.
functions-by-step.txt  py/settle.py: functions per landing step.
k4-early-callers.tsv    py/k4path.py: the functions that the run of `const x: number = "s";` enters from a caller of an earlier landing step.
go-slice-probe.txt     goprobe/main.go: Go's own answers for the slice identity and aliasing cases that tests.rs asserts.
pub-crate-field-probe.txt        cargo check with one field and one method of the checker as pub(crate): dead_code rejects both.
free-function-argument-probe.txt cargo check of two call shapes: a field read in an argument compiles, a nested &mut call does not.
run.log                the last full run of ../run.sh (38 tests: 18 of this scratch, 10 of the node table, 10 of the diagnostics block).
