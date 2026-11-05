// answers: without-library
// # each() calls what it is handed in a loop of its own, and hands the list and the function on to rest(), which goes on from the same index in a second loop: the shape of the library's methods of lists (a run over a plain vector, then <method>From).
// # The copy of each() in user() has the arrow in its loop. rest() is called: copied as well, the unit held two more loops and two more copies of the arrow.
// # RUN(FORM): walk f3 mechanisms=all
// # FORM-LABEL: code f3:Body
// # FORM: callee=f2
// # FORM: = CallDirect {{*}}function=f1
// # RUN(NEVER): walk f3 mechanisms=all
// # NEVER-NOT: callee=f1
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
function rest(list: number[], f: (x: number) => void, i: number) { for (; i < list.length; i++) f(list[i]); }
function each(list: number[], f: (x: number) => void) { let i = 0; for (; i < list.length && list[i] > 0; i++) f(list[i]); rest(list, f, i); }
function user(list: number[], k: number) { let sum = 0; each(list, x => { sum += x * k; }); return sum; }
for (let round = 0; round < 3; round++) { report(user([1, 2, -3, 4], round)); report(user([], 2)); report(user([-1], 3)); report(user([5, 6], round)); }
report("end");
