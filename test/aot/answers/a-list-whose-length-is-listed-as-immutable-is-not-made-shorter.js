// answers: without-library
// # A store of a shorter length into a proven list. The structure of the last list lists `length` as immutable, which only the testing object of the shell can bring about: the store is refused.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell --useDollarVM=1 $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
const tools = globalThis["$" + "vm"];
function act(list) { list.length = 2; return 0; }
function fill(n) { const list = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
let warm = 0;
for (let i = 0; i < 50; i++) { const list = fill(5); act(list); warm += list.length; }
report(warm);
const rows = fill(5);
if (tools) tools.makePropertiesImmutable(rows, ["length"]);
let said = "done";
try { said = "told " + act(rows); } catch (error) { said = error.name; }
report(said);
report(rows.length);
report(rows.join());
report("end");
