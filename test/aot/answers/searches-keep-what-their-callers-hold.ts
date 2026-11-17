// answers: with-library
// # a loop holds a counter, a sum, a fraction and a text across calls of indexOf and includes, whose functions may be ones that save what they write
// # the form shows in tests/plan/tail-calls/search-of-the-library-saves-the-registers-of-its-callers.ir alone: the two functions of today's library each make a call in tail position, which the rule refuses
// # f1 = positions, f2 = tell
// # LIBRARY: own
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: isLoopHead=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function positions(list: unknown[], wanted: unknown[]): string { let text = ""; let sum = 0; let scale = 1.5; for (let i = 0; i < wanted.length; i++) { const at = list.indexOf(wanted[i]); const has = list.includes(wanted[i]); sum += at * (i + 1); scale += at; text += at + (has ? "y" : "n"); } return text + ":" + sum + ":" + scale; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => positions([1, 2, 3], [3, 1, 9]));
tell(() => positions([1.5, NaN, "a", undefined, null], [NaN, undefined, null, "a", 1.5]));
tell(() => positions([, 1] as any, [undefined, 1]));
tell(() => positions([], [1]));
tell(() => positions(["a", "b", "ab"], ["a" + "b", "b", "c"]));
tell(() => positions([{}, tell], [tell, {}]));
tell(() => positions(null as any, [1]));
tell(() => positions([1, 2, 3], [2]));
report("end");
