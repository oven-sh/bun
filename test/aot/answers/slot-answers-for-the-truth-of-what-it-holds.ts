// answers: with-library
// # `if (knot.part)`, `knot.label ? a : b`: a read that tests its receiver for itself, at the end of its block, outside of loops, and nothing but the truth of what it reads is asked.
// # The slot is held to a type, and whoever stores goes by it: so on the way on which the receiver passes, the word in the slot and that type say the answer, and the way leads to the targets of the branch at once.
// # Nothing is boxed there, no type is tested and no stub is asked. Only what is read by name is a value, and it goes by the tests that stand behind the read.
// # The objects are those of a constructor function, their fields are stored behind the making, and each reader calls itself once more so that its own code runs.
// # Whatever is stored from out of sight, a value of another type takes the field out of its slot, and the answer is that of the language: texts, numbers, big integers and objects where a part, a text and a boolean are written,
// # undefined and null, a field that is deleted, defined anew, made an accessor, found below or behind a proxy, and a field that lies on the prototype where the slot is empty.
// # f7 = hasPart, f8 = asksPart, f9 = asksLabel, f10 = asksOpen, f11 = asksLeaf
// # RUN(HELD): facts enforced mechanisms=all
// # HELD: "part" {{*}} held=undefined|null|L0
// # HELD: "label" {{*}} held=undefined|null|string
// # HELD: "open" {{*}} held=undefined|null|boolean
// # RUN(WALK): walk f8 mechanisms=all
// # WALK-LABEL: code f8:Body
// # WALK: [[read]]: {{*}} = GetSlotOrUndefined {{*}} key="part" {{*}} level=Expected
// # WALK-NEXT: = TypeTest [[read]] testedType=object
// # RUN(PART): emit f8:Body mechanisms=all
// # PART: = BitAnd(@4, {{*}}origin = [[read]])
// # PART-NOT: = Phi(origin = [[read]])
// # RUN(OPEN): emit f10:Body mechanisms=all
// # OPEN: = BitAnd(@4, {{*}}origin = [[read]])
// # OPEN-NOT: = Phi(origin = [[read]])
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 268 of 268 of 268
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Part { rank: number; constructor(rank: number) { this.rank = rank; } }
interface Knot { kind: number; flags: number }
interface Leaf extends Knot { part?: Part; label?: string; open?: boolean }
interface Stem extends Knot { part?: Part; more: number }
interface Twig extends Knot { other: number }
function KnotObject(this: Knot, kind: number) { this.kind = kind; this.flags = 0; }
function make<T extends Knot>(kind: number): T { return new (KnotObject as any)(kind); }
function makeLeaf(part: Part | undefined, label: string | undefined, open: boolean | undefined): Leaf { const leaf = make<Leaf>(1); leaf.part = part; leaf.label = label; leaf.open = open; return leaf; }
function makeBareLeaf(): Leaf { return make<Leaf>(1); }
function makeStem(part: Part | undefined): Stem { const stem = make<Stem>(2); stem.part = part; stem.more = 1; return stem; }
function makeTwig(): Twig { const twig = make<Twig>(3); twig.other = 1; return twig; }
function hasPart(knot: Leaf | Stem): boolean { return !!knot.part; }
function asksPart(knot: Leaf | Stem, again: number): string { if (again > 0) return asksPart(knot, again - 1); if (knot.part) return "part"; return "none"; }
function asksLabel(knot: Leaf, again: number): string { if (again > 0) return asksLabel(knot, again - 1); return knot.label ? "label" : "bare"; }
function asksOpen(knot: Leaf, again: number): string { if (again > 0) return asksOpen(knot, again - 1); if (knot.open) return "open"; return "shut"; }
function asksLeaf(knot: Knot, again: number): string { if (again > 0) return asksLeaf(knot, again - 1); return knot.kind === 1 && hasPart(knot as Leaf) ? "leaf with a part" : "other"; }
const shelf: any = globalThis;
shelf.fromOutside = [asksPart, asksLabel, asksOpen, asksLeaf, makeTwig];
function unseen(thing: unknown): any { shelf.laidDown = thing; return shelf.laidDown; }
const first = new Part(1);
const partName = ["pa", "rt"].join("");
const labelName = ["la", "bel"].join("");
const openName = ["op", "en"].join("");
let asked = 0;
function stored(part: unknown, label: unknown, open: unknown): unknown { const knot = makeLeaf(first, "text", true); Reflect.set(unseen(knot), partName, part); Reflect.set(unseen(knot), labelName, label); Reflect.set(unseen(knot), openName, open); return knot; }
function storedAndBack(): unknown { const knot = stored(0, NaN, "x"); Reflect.set(unseen(knot), partName, first); Reflect.set(unseen(knot), labelName, ""); Reflect.set(unseen(knot), openName, false); return knot; }
function filledLate(): unknown { const knot = makeBareLeaf(); unseen(knot).part = 1; unseen(knot).label = "late"; unseen(knot).open = -0; return knot; }
function deleted(): unknown { const knot = makeLeaf(first, "text", true); delete unseen(knot).part; delete unseen(knot).label; delete unseen(knot).open; return knot; }
function getter(): unknown { const knot = makeLeaf(undefined, "", false); Object.defineProperty(unseen(knot), partName, { get() { asked++; return 1; } }); return knot; }
function defined(): unknown { const knot = makeLeaf(first, "text", true); Object.defineProperty(unseen(knot), partName, { value: 0n, writable: true }); Object.defineProperty(unseen(knot), openName, { value: "" }); return knot; }
function below(): unknown { return Object.create(unseen(makeLeaf(first, "text", true))); }
function behindProxy(): unknown { return new Proxy(unseen(makeLeaf(first, "", false)), { get(target: any, key) { asked++; return Reflect.get(target, key); } }); }
function assigned(): unknown { return Object.assign(unseen(makeLeaf(undefined, "", false)), JSON.parse('{"part":"0","label":[],"open":1}')); }
function parsed(): unknown { return JSON.parse('{"kind":1,"part":0,"label":{},"open":"0"}'); }
function all(): unknown[] { return [makeLeaf(first, "x", true), makeLeaf(undefined, "", false), makeLeaf(undefined, undefined, undefined), makeBareLeaf(), makeStem(first), makeStem(undefined), makeTwig(), stored("", 0n, 0), stored("text", first, 0.5), stored(null, null, null), stored(undefined, undefined, undefined), stored(NaN, 1n, -0), stored(false, true, first), storedAndBack(), filledLate(), deleted(), getter(), defined(), below(), behindProxy(), assigned(), parsed()]; }
function drive(knots: unknown[]): void { for (let which = 0; which < knots.length; which++) { const knot = unseen(knots[which]); report(asksPart(knot, 2)); report(asksLabel(knot, 2)); report(asksOpen(knot, 2)); report(asksLeaf(knot, 2)); } report(asked); }
drive(all());
drive(all());
Reflect.set(unseen(KnotObject.prototype), partName, 1);
drive(all());
report("end");
