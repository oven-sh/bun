// answers: with-library
// # `new Grow(2) as Twig`: a tagged maker makes an object of the member that its tag picks, also where something else is written below the maker (Sprout). Link took what it makes for the maker's own layout,
// # nothing of which passes `as Twig`: so `.later = 1` was charged to no layout, and the member was proven never to gain a property: the run time stopped at the AddProperty.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
interface Part { kind: number; flags: number; name: string; x?: object; y: number | undefined; z?: string; w?: Part }
interface Leaf extends Part { kind: 1; value: number }
interface Twig extends Part { kind: 2; text: string }
function Grower(this: Part, kind: number) { this.kind = kind; this.flags = 0; this.name = ""; this.x = undefined; this.y = undefined; this.z = undefined; this.w = undefined; }
function Sprout(this: any) { this.tall = 1; }
Sprout.prototype = Object.create(Grower.prototype);
const Grow = Grower as unknown as new (kind: number) => Part;
function leaf(value: number): Leaf { const made = new Grow(1) as Leaf; made.value = value; return made; }
function twig(text: string): Twig { const made = new Grow(2) as Twig; made.text = text; return made; }
const make = (flags: number, name: string): Part => { const made: Part = flags & 1 ? leaf(flags) : twig(name); made.flags = flags; made.name = name; return made; };
const other = make(8, "other"); (other as any).later = 1;
const fresh = make(1, "fresh");
report(Object.keys(other).join());
report(Object.keys(fresh).join());
report(new (Sprout as any)() instanceof Grower);
report("end");
