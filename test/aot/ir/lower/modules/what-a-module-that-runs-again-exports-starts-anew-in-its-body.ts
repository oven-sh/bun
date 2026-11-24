// `bun test --rerun-each` loads a test file several times in one realm, and plain Bun makes a new module of it each time. What the file exports is a variable of the program,
// which is there once (./a-module-that-runs-again-declares-no-variables-of-the-program.ts), so the body lays its first state each time it is entered: a `var` is undefined, a `let` is in
// its dead zone, and a declared function is made there. Where the file runs once, the function is what the variable is born with.
// OPTIONS(AGAIN): entry-points-run-again
// OPTIONS(RECORDS): entry-points-run-again

// RUN(AGAIN): lower
// AGAIN-LABEL: function {{*}}kind=Module
// AGAIN: [[undefined]] = Undefined
// AGAIN: PutModuleVariable [[undefined]]
// AGAIN: [[absent]] = Absent
// AGAIN: PutModuleVariable [[absent]]
// AGAIN: [[closure]] = NewClosure
// AGAIN: [[made]] = Convert [[closure]]
// AGAIN: PutModuleVariable [[made]]

// RUN(RECORDS): link
// RECORDS-NOT: variable {{*}}name="tally"{{*}}initialization=Function
// RECORDS: variable {{*}}name="tally"

// RUN(ONCE): link
// ONCE: variable {{*}}name="tally"{{*}}initialization=Function

export function tally() {
  return 1;
}
export var loose: number | undefined;
export let late = tally();
