// answers: without-library
// # `try { if (got < floor) throw 1; } catch { throw "below the floor"; }` in a callee that is copied into the typed copy of a loop: the throw is a jump behind the head of the handler block, past its catch.
// # The handler block only throws, and nothing of the turn was done: the turn begins again in the other copy and the block is not walked. The next block of the frame, the handler of the `try` in front, is walked from its first operation: `e` is what was caught.
// # The place behind the catch once stayed noted in the frame and the next handler block lost its CatchValue: the compiler stopped in the walk of `total`.
// # f1 = pick, f2 = id, f3 = total
// # RUN(COUNT): compile TurnsThatBeginAgain mechanisms=all
// # One turn begins again: the one that throws. It has done nothing yet, so the other copy does the whole turn. (There were two: the typed copy tested what `pick` answers for a number. Since a declared field is born with what its constructor stores, Link proves i32 of `v`: the test is gone by that proof.)
// # COUNT: statistic TurnsThatBeginAgain 1
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
class Box { v: number; constructor(v: number) { this.v = v; } }
class Item { box: Box | null; constructor(box: Box | null) { this.box = box; } }
class Scale { by: number; constructor(by: number) { this.by = by; } }
function pick(item: Item, floor: number): number { let got = 0; try { got = item.box!.v; } catch (e) { return e ? -1 : -2; } try { if (got < floor) throw 1; } catch { throw "below the floor"; } return got; }
const scales: Scale[] = [new Scale(2)];
if (id(0)) scales.push(id(0) as any);
function total(full: Item, empty: Item, n: number, floor: number): number { const scale = scales[0]; let sum = 0; for (let i = 0; i < n; i++) sum += scale.by + pick(i % 7 === 3 ? empty : full, floor); return sum; }
const full = new Item(new Box(10));
const empty = new Item(null);
report(total(full, empty, 300, 0));
try { report(total(full, empty, 300, 50)); } catch (e) { report(String(e)); }
report("end");
