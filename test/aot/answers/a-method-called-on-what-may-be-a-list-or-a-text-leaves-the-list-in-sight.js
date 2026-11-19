// answers: with-library
// # What a Map gives may be a list that the program makes or a text. `sort` is a method of lists; above a text nobody knows it. Code that nobody has seen and that is found above a text gets the text as `this`:
// # the list is answered by its own class, so neither the list nor its rows go out of sight with the call. The arguments leave and the answer is anything, as before.
// # RUN(LINK): link layouts mechanisms=all
// # LINK: layout L0 {{*}}changes=[] stays-with-compiled-code
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
class Row { constructor(a) { this.a = a; } }
const list = [new Row(3), new Row(1), new Row(2)];
const held = new Map([["list", list], ["other", "text"]]);
function sum() { let s = 0; for (let i = 0; i < list.length; i++) s = s * 10 + list[i].a; return s; }
function attempt(x) { try { return typeof x.sort((p, q) => p.a - q.a); } catch (error) { return error.name; } }
report(sum());
report(attempt(held.get("list")));
report(attempt(held.get("other")));
report(sum());
report("end");
