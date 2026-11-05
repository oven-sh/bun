// answers: without-library
// # a direct call that the Straight emitter writes brings its numbers into the argument FPRs and then its integers into the GPRs. An int32 that arrives boxed as a double, out of a slot that two classes of one union share, is converted through no argument register: the first number stays what it was (mix was once entered with ratio = 3)
// # weigh and weighLast are handed an object that is not of their parameter's class, so their slow versions run, which are written straight. weighLast leaves by the call
// # RUN(FORM): plan units mechanisms=all
// # FORM: :Body (Double, Int32) -> (Double)
// # FORM: :SlowBody (JSValue) -> (Double)
// # FORM: :SlowBody (JSValue) -> (Double)
// # x
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
class Whole { size = 3; }
class Half { size = 0.5; }
type Piece = Whole | Half;
class Tag { n = 1; m = 2; }
const unseen = (x: any): any => [x][JSON.parse("0")];
const unit = new Whole();
const half = new Half();
function sizeOf(piece: Piece): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return piece.size * 2 + work; }
function main() { function mix(ratio: number, steps: number): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return ratio * steps + work; } function weigh(tag: Tag): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; return mix(0.25, unit.size) + work; } function weighLast(tag: Tag): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; return mix(work / 8, unit.size); } const real = new Tag(); let total = 0; for (let turn = 0; turn < 300; turn++) total += weigh(real) + weighLast(real); report(total); report(weigh(real)); report(weighLast(real)); const liar = unseen({ n: 1, m: 2 }); report(weigh(liar)); report(weighLast(liar)); }
report(sizeOf(unit));
report(sizeOf(half));
main();
report("end");
