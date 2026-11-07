// answers: without-library
// # `function makeReader(crate: Crate) { return () => crate.weight }`: a capture by value arrives as an entry parameter of the closure's body. Link kept what is written of it only where that
// # is one built-in class: of a capture written as a class or as a record nothing was expected, and every read off it went by name.
// # Now whatever is written of a capture is expected of it, as of a parameter, and is tested where it is used: whatever else arrives takes the closed arm.
// # f1 = id, f2 = makeReader, f3 = makeReaderOfRecord, f4 = Crate, f5 = Barrel, f6 = weight, f7 = get, f8 = the closure that makeReader makes, f9 = the one that makeReaderOfRecord makes
// # RUN(CLASS): walk f8 mechanisms=all
// # CLASS: = GetSlot v0 key="weight" {{*}}level=Expected
// # RUN(RECORD): walk f9 mechanisms=all
// # RECORD: = GetSlot v0 key="depth" {{*}}level=Expected
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 12 of 12 of 12
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
class Crate { weight: number; label: string; constructor(weight: number, label: string) { this.weight = weight; this.label = label; } }
class Barrel extends Crate { hoops = 2; }
function makeReader(crate: Crate): () => number { return () => crate.weight * 2; }
function makeReaderOfRecord(hole: { depth: number; name: string }): () => number { return () => hole.depth + 1; }
const light: Crate = id(new Crate(3, "light"));
const heavy: Crate = id(new Crate(40.5, "heavy"));
report([id(makeReader(light))(), id(makeReader(heavy))(), id(makeReader(id(new Barrel(8, "barrel"))))()].join(" "));
report(id(makeReader(id({ weight: 7 } as any)))());
report(id(makeReader(id({ get weight() { return 11; } } as any)))());
report(String(id(makeReader(id("text" as any)))()));
let thrown = "";
try { id(makeReader(id(undefined as any)))(); } catch (error) { thrown = (error as Error).constructor.name; }
report(thrown);
const changed: Crate = id(new Crate(5, "changed"));
const readChanged = id(makeReader(changed));
report(readChanged()); changed.weight = 6; report(readChanged());
delete (changed as any).weight; report(String(readChanged()));
Object.defineProperty(changed, "weight", { get() { return 9; }, configurable: true }); report(readChanged());
Object.setPrototypeOf(changed, { extra: 1 }); report(readChanged());
report([id(makeReaderOfRecord(id({ depth: 4, name: "shallow" })))(), id(makeReaderOfRecord(id({ name: "other order", depth: 5 })))(), id(makeReaderOfRecord(id({ depth: 6 } as any)))()].join(" "));
report("end");
