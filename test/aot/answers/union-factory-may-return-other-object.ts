// answers: without-library
// # One function makes both members of a union, by the tag that it is given. Where it returns another object, `new` answers with that one.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
const spare = { kind: 1, pos: -1, value: -1, spare: true };
function NodeMaker(this: Base, kind: number, other?: boolean) { this.kind = kind; this.pos = 0; if (other) return spare; }
const Node = NodeMaker as unknown as new (kind: number, other?: boolean) => Base;
function num(value: number): Num { const made = new Node(1) as Num; made.value = value; return made; }
function str(text: string): Str { const made = new Node(2) as Str; made.text = text; return made; }
function read(one: Num | Str): string { return one.kind === 1 ? "num " + one.value : "str " + one.text; }
report(read(num(1))); report(read(str("s"))); report(new Node(1, true) === spare); report(new Node(2, true) === spare);
report("end");
