// answers: without-library
// # A typed loop stands inside a typed loop. The head of the inner typed copy begins a turn of its own; what leaves the inner loop says nothing of the turn of the loop around, which has done a deed in front of it.
// # The one bit of the state was once cleared at the inner head and carried out, and the failing test of `extra.value` began the OUTER turn again: `deeds` counted 41 for 40.
// # f1 = id, f2 = run
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
type Box = { value: number };
type Table = { scale: number };
let deeds = 0;
function run(rows: Box[][], extras: Box[], tables: Table[]): number { const table = tables[0]; let total = 0; for (let r = 0; r < rows.length; r++) { deeds++; total += table.scale; const row = rows[r]; const extra = extras[r]; let sum = 0; let i = 0; for (; i < row.length; i++) sum += row[i].value; total += (sum | 0) + (i & 7) + extra.value; } return total; }
const rows: Box[][] = []; const extras: Box[] = []; const tables: Table[] = [{ scale: 2 }];
for (let r = 0; r < 40; r++) { const row: Box[] = []; for (let i = 0; i < 10; i++) row.push({ value: 1 }); rows.push(row); extras.push({ value: 1 }); }
extras[25] = JSON.parse('{"value":1}');
id(run);
report(run(id(rows), id(extras), id(tables)) + " " + deeds);
report(run(id(rows), id(extras), id(tables)) + " " + deeds);
report("end");
