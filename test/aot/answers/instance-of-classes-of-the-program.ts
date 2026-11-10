// answers: without-library
// # `x instanceof C` with C a class or a constructor function of the program, of its instances, of what was laid below its prototype object by hand, of instances that were laid below something else, and of what is no object
// # f1 = V, f2 = isLeaf, f3 = isTwig, f4 = isV, f5 = leafOrStone, f7 = tell, f6 = all
// # the deeds stand in plain sight, so Link proves of no class here that it stays as written, and the way behind the guards of classes is withdrawn: the operator stands as it is written, which is what these answers hold
// # the form has a program of its own: instance-of-classes-that-stay-as-written.ts. Once the way behind guards is back the line below turns red, and says `= ShapeTest` again
// # RUN(WRITTEN): walk f2 mechanisms=all
// # WRITTEN-LABEL: code f2:Body
// # WRITTEN: = InstanceOf
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 37 of 37 of 37
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 37 of 37 of 37
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
class Leaf { a = 1; }
class Twig extends Leaf { b = 2; constructor() { super(); } }
class Stone { c = 3; }
function V(this: any, x: number) { this.x = x; }
function isLeaf(x: unknown): boolean { return x instanceof Leaf; }
function isTwig(x: unknown): boolean { return x instanceof Twig; }
function isV(x: unknown): boolean { return x instanceof (V as any); }
function leafOrStone(x: Leaf | Stone): string { return x instanceof Leaf ? "leaf " + x.a : "stone " + x.c; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function all(x: unknown): string { return isLeaf(x) + "," + isTwig(x) + "," + isV(x); }
const values: unknown[] = [new Leaf(), new Twig(), new Stone(), new (V as any)(1), {}, [], null, undefined, 5, "text", true, Object.create(null)];
for (let turn = 0; turn < 40; turn++) { for (let i = 0; i < values.length; i++) { const said = all(values[i]); if (turn === 0 || turn === 39) report(i + " " + said); } }
tell(() => leafOrStone(new Leaf()) + " " + leafOrStone(new Twig()) + " " + leafOrStone(new Stone()));
tell(() => all(Leaf.prototype) + " " + all(Twig.prototype) + " " + all((V as any).prototype));
tell(() => all(Object.create(Leaf.prototype)) + " " + all(Object.create(Twig.prototype)) + " " + all(Object.create((V as any).prototype)));
tell(() => all(Leaf) + " " + all(V));
const moved = new Twig();
tell(() => all(moved));
Object.setPrototypeOf(moved, Stone.prototype);
tell(() => all(moved) + " " + (moved instanceof Stone));
Object.setPrototypeOf(moved, Leaf.prototype);
tell(() => all(moved));
Object.setPrototypeOf(moved, null);
tell(() => all(moved));
const adopted = { own: 1 };
tell(() => all(adopted));
Object.setPrototypeOf(adopted, Twig.prototype);
tell(() => all(adopted));
const movedV = new (V as any)(2);
Object.setPrototypeOf(movedV, Leaf.prototype);
tell(() => all(movedV));
tell(() => all(Reflect.construct(Leaf, [], Stone)) + " " + all(Reflect.construct(Stone, [], Twig)) + " " + all(Reflect.construct(V, [1], Leaf)));
report("end");
