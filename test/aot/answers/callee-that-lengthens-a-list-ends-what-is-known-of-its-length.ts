// answers: without-library
// # the callee pushes onto a list that is as its class makes it: by the first row of push it runs no other code, and it writes into no object of a layout, so Link has no bit for what it writes. A list has every bit, and the call ends what the caller has noted of its length: each of the three reads is built
// # a store under a computed key would not do: of that Link says unknown code, and the bits are never asked
// # f1 = grow, f2 = deed, f3 = tell
// # RUN(FORM): walk f2 mechanisms=all-Inlining
// # FORM-LABEL: code f2:Body
// # FORM-COUNT-3: = GetArrayLength
// # RUN(QUIET): walk f2 mechanisms=all-Inlining
// # QUIET-NOT: = CallDirect {{*}}function=f1{{*}}mayCallUnknownCode
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=all-Inlining $SHELL
// # ALSO1: 4 of 4 of 4
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function grow(list: number[], value: number) { list.push(value); }
function deed(list: number[]) { const before = list.length; grow(list, 7); const between = list.length; grow(list, 8); return before * 100 + between * 10 + list.length; }
const held = [1, 2, 3];
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => deed(held));
tell(() => deed(held));
tell(() => held.length);
report("end");
