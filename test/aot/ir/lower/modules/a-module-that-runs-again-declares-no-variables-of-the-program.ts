// `bun test --rerun-each` loads a test file several times in one realm. Plain Bun makes a new module of it each time, so a closure that an earlier run left behind
// goes on with what that run declared. A variable of the program is there once: what the file declares is held as what a function declares, in an environment of the run.
// What it exports is a variable all the same, for the files that import it.
// OPTIONS(AGAIN): entry-points-run-again
// OPTIONS(RECORDS): entry-points-run-again

// RUN(AGAIN): lower
// AGAIN-LABEL: function {{*}}kind=Module
// AGAIN: = NewObject {{*}}layout=[[environment]]
// AGAIN-LABEL: function {{*}}name="bump"
// AGAIN-NOT: ModuleVariable
// AGAIN: = GetEnvironmentField {{*}}layout=[[environment]]
// AGAIN: PutEnvironmentField {{*}}layout=[[environment]]

// RUN(RECORDS): link
// RECORDS-NOT: variable {{*}}name="count"
// RECORDS-NOT: variable {{*}}name="bump"
// RECORDS: variable {{*}}name="shown"
// RECORDS: module {{*}}flags=[{{*}}RunsAgain

// RUN(ONCE): link
// ONCE: variable {{*}}name="count"
// ONCE-NOT: RunsAgain

let count = 0;
function bump() {
  return ++count;
}
export const shown = bump;
