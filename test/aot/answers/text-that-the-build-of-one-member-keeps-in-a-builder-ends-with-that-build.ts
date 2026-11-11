// answers: without-library
// # `held` is an object of one of two classes, so the loop is built once for each of them. Each build keeps the text that grows in a builder of its own and ends it: what leaves a build is a string, and so is what enters the next.
// # The builder once stayed noted behind the build of the first member: the head of the next build took the text for a builder, and the compiler stopped in the walk of `spell`: opaque(StringBuilder) comes round.
// # f1 = fail, f2 = revived, f3 = spell
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Point { x: number = 1; }
class Other { x: number; constructor(x: number) { this.x = x; } }
type Flat = Point | Other;
let outside: Flat = new Point();
function fail(when: boolean): void { if (when) throw new Error("no"); }
function revived(o: Flat): Flat { return JSON.parse("[0]", (key, value) => (key === "0" ? o : value))[0]; }
function spell(p: number): string { let out = ""; const held: Flat = revived(new Other(p + 1)); for (let i = 0; i < 3; i++) { out += held.x; try { fail(i === 1 && p % 3 === 0); } catch { } } return out; }
for (let round = 0; round < 12; round++) report(spell(round));
report(outside.x);
report("end");
