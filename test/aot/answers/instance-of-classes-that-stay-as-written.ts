// answers: without-library
// # `x instanceof Leaf` as the front end writes it, in a program that does nothing to its classes, their prototype objects or their instances but construct and ask: Link proves that each class stays as written, which the form wants
// # the deeds that take that proof away have answers/instance-of-classes-of-the-program.ts and programs/instanceof-of-classes/
// # f1 = isLeaf, f2 = isTwig, f3 = leafOrStone, f4 = twigIsLeaf, f5 = stoneIsLeaf, f6 = numberIsLeaf, f7 = tell, f8 = both
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = ShapeTest
// # RUN(NEVER): walk f1 f2 f3 f4 f5 f6 mechanisms=all
// # NEVER-NOT: = InstanceOf
// # what the type decides is a constant
// # RUN(CONSTANT): walk f4 f5 f6 mechanisms=all
// # CONSTANT-NOT: ShapeTest
// # CONSTANT-NOT: HasInPrototypeChain
// # RUN(TRUE): walk f4 mechanisms=all
// # TRUE-LABEL: code f4:Body
// # TRUE: Boolean boolean=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 29 of 29 of 29
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 29 of 29 of 29
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
class Leaf { a = 1; }
class Twig extends Leaf { b = 2; constructor() { super(); } }
class Stone { c = 3; }
function isLeaf(x: unknown): boolean { return x instanceof Leaf; }
function isTwig(x: unknown): boolean { return x instanceof Twig; }
function leafOrStone(x: Leaf | Stone): string { return x instanceof Leaf ? "leaf " + x.a : "stone " + x.c; }
function twigIsLeaf(x: Twig): boolean { return x instanceof Leaf; }
function stoneIsLeaf(x: Stone): boolean { return (x as unknown) instanceof Leaf; }
function numberIsLeaf(x: number): boolean { return (x as unknown) instanceof Leaf; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function both(x: unknown): string { return isLeaf(x) + "," + isTwig(x); }
const values: unknown[] = [new Leaf(), new Twig(), new Stone(), { z: 1 }, [1], null, undefined, 5, "text", true];
for (let turn = 0; turn < 40; turn++) { for (let i = 0; i < values.length; i++) { const said = both(values[i]); if (turn === 0 || turn === 39) report(i + " " + said); } }
tell(() => leafOrStone(new Leaf()) + " " + leafOrStone(new Twig()) + " " + leafOrStone(new Stone()));
tell(() => twigIsLeaf(new Twig()));
tell(() => twigIsLeaf(new Twig()));
tell(() => stoneIsLeaf(new Stone()));
tell(() => stoneIsLeaf(new Stone()));
tell(() => numberIsLeaf(5));
tell(() => numberIsLeaf(6.5));
tell(() => { let count = 0; for (let i = 0; i < 300; i++) { const x = i % 3 === 0 ? new Leaf() : i % 3 === 1 ? new Twig() : new Stone(); if (isLeaf(x)) count += 1; if (isTwig(x)) count += 1000; } return count; });
report("end");
