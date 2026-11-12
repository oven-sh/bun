// answers: without-library
// # Link proves that every caller hands an integer over, so the parameter is raw. One caller is an arrow that is kept in a list and called out of it, and what it hands over is its capture, of which its walk knows nothing:
// # it tests the operand, and the failing side traps. A direct call that is written has no closure to fall back on: without the test the walk of the arrow stops ("a value has no conversion into the form in which it is wanted")
// # function has(t, k) { return (t.flags & k) !== 0 || some(t.parts, p => has(p, k)); }, declared in a function and only called by its name
// # RUN(FORM): plan units mechanisms=all
// # FORM: :Body ({{*}}Int32) -> (Boolean)
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO1: 5 of 5 of 5
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO2: 5 of 5 of 5
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-UnboxedNumbers $SHELL
// # ALSO3: 5 of 5 of 5
// # ALSO3-NEXT: exited with 0
declare function report(value: unknown): void;
interface Item { flags: number; parts?: Item[] }
const kept: Array<(t: Item) => boolean> = [];
function some(list: Item[], test: (t: Item) => boolean): boolean { kept.push(test); for (let i = 0; i < list.length; i++) if (kept[kept.length - 1](list[i])) return true; return false; }
function make() { let calls = 0; return { check, count: () => calls }; function check(t: Item, kind: number): boolean { return has(t, kind); } function has(t: Item, k: number): boolean { calls++; return (t.flags & k) !== 0 || (t.parts !== undefined && some(t.parts, p => has(p, k))); } }
const m = make();
report(m.check({ flags: 1, parts: [{ flags: 2 }, { flags: 8, parts: [{ flags: 4 }] }] }, 4));
report(m.check({ flags: 1, parts: [{ flags: 2 }] }, 16));
report(m.count());
report(some([{ flags: 3 }], t => t.flags === 3));
report("end");
