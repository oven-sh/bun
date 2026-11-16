// answers: without-library
// # `return anyOf(crate.sizes, size => size > least)`: where the guesses hold, anyOf() and the arrow stand in line and no closure is made. It is made in the two closed arms alone, which call anyOf().
// # anyOf() only calls what arrives, so the arrow could lie in the frame. But a cell in the frame is a stack slot of the unit: the frame gets a record and room for it, and where a rare block
// # leaves something in the frame the setup goes up to what dominates it: every way of the unit pays for what its usual ways never do. A closure whose block is not a usual one stays in the heap.
// # f1 = anyOf, f2 = id, f3 = holdsWide, f4 = the arrow
// # RUN(RARE): walk f3 mechanisms=all
// # RARE: frequency=Rare
// # RARE: = NewClosure
// # RUN(HEAP): walk f3 mechanisms=all
// # HEAP-NOT: storage=Frame
// # RUN(STUB): bytes f3 mechanisms=all
// # STUB: NewSlimClosure.Plain
// # RUN(NEVER): bytes f3 mechanisms=all
// # NEVER-NOT: NewSlimClosureInFrame
// # Nothing is copied in line: the call and the arrow stand on a usual way, and the arrow lies in the frame as ever.
// # RUN(USUAL): bytes f3 mechanisms=all-Inlining
// # USUAL: NewSlimClosureInFrame.Plain
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
interface Crate { kind: number; sizes?: number[]; }
function anyOf(list: readonly number[] | undefined, test: (size: number) => boolean): boolean { if (list !== undefined) { for (let index = 0; index < list.length; index++) { if (test(list[index])) return true; } } return false; }
function holdsWide(crate: Crate, least: number): boolean { if (crate.kind === 1) return true; if (crate.kind === 2) return false; return anyOf(crate.sizes, size => size > least); }
const crates: Crate[] = id([{ kind: 1 }, { kind: 2 }, { kind: 3, sizes: [1, 5, 9] }, { kind: 3, sizes: [1, 2] }, { kind: 3 }]);
let wide = 0;
for (let round = 0; round < 3; round++) { for (const crate of crates) if (holdsWide(crate, 4 + round)) wide++; }
report(wide);
const likeList = id({ kind: 3, sizes: { length: 2, 0: 3, 1: 40 } } as unknown as Crate);
report([holdsWide(likeList, 10), holdsWide(likeList, 50)].join(" "));
const otherOrder = id({ sizes: [7, 8], label: "other order", kind: 3 } as Crate);
report([holdsWide(otherOrder, 7), holdsWide(otherOrder, 8)].join(" "));
const texts = id({ kind: 3, sizes: ["12", "5"] } as unknown as Crate);
report([holdsWide(texts, 11), holdsWide(texts, 12)].join(" "));
const byGetter = id({ kind: 3, get sizes() { return [2.5]; } } as Crate);
report([holdsWide(byGetter, 2), holdsWide(byGetter, 3)].join(" "));
let thrown = "";
try { holdsWide(id({ kind: 3, sizes: { length: 1, get 0(): number { throw new RangeError("no size"); } } } as unknown as Crate), 1); } catch (error) { thrown = (error as Error).message; }
report(thrown);
try { holdsWide(id(undefined as unknown as Crate), 1); } catch (error) { thrown = (error as Error).constructor.name; }
report(thrown);
let manyWide = 0;
for (let round = 0; round < 20000; round++) { if (holdsWide(likeList, round % 64)) manyWide++; }
report(manyWide);
report("end");
