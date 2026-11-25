// answers: without-library
// # Nobody knows the tag at either `new`, so both call the entry of the constructor that makes `this`: with more arguments than there are registers, and with fewer than the constructor has parameters.
// # The tag of a member, the tag of no member and a value that is no number each give an object that answers as it should, also below the object that `prototype` holds later.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 26 of 26 of 26
// # CHECK-NEXT: exited with 0
interface Base { kind: number; pos: number; sum: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function NodeMaker(this: Base, kind, pos, a, b, c) { this.kind = kind; this.pos = pos; this.sum = a + b + c; }
const Node = NodeMaker;
function make(kind, pos) { return new Node(kind, pos, 1, 2, 3); } // @ts-expect-error
function few(kind) { return new Node(kind); }
function tell(n) { report(n.kind); report(n.pos); report(n.sum); report(n instanceof Node); } // @ts-expect-error
tell(make(id(1), 7)); tell(make(id(2), 8)); tell(make(id(9), 9)); tell(make(id("x"), 10)); tell(few(id(1))); // @ts-expect-error
const num = make(id(1), 0); num.value = 5; report(num.value); // @ts-expect-error
const str = make(id(2), 0); str.text = "t"; report(str.text);
Node.prototype = { marker: 5 }; // @ts-expect-error
const late = make(id(1), 11); report(late.marker); report(late.kind); report(late instanceof Node);
report("end");
declare function report(value: unknown): void;
