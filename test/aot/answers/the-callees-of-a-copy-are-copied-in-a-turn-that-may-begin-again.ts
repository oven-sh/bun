// answers: without-library
// # `total += measured(boxes[i & 3]) * table.scale`, measured > checked > area: in the typed copy of the loop the turn may begin again, so the callees of the copy are copied too, the looks count on the guesses in the copies,
// # and the block that only throws is left to the other copy: no call of `checked` or of `area` is left in the unit, and the one of `measured` stands in the other copy.
// # A store of a copy into a variable is undone where the turn begins again: behind `calls++` the read counts on its look, and on the way to the other copy the old value is written back.
// # OPTIONS: check=Validate
// # f1 = id, f2 = area, f3 = checked, f4 = measured, f5 = counted, f6 = sumOfMeasures, f7 = sumOfCounted
// # RUN(FORM): walk f6 mechanisms=all-ParameterGuards
// # FORM-NOT: = CallDirect {{*}}function=f3
// # FORM-NOT: = CallDirect {{*}}function=f2
// # RUN(DEED): walk f7 mechanisms=all-ParameterGuards
// # DEED: = PutModuleVariable
// # DEED: = ShapeTest
// # DEED: = GetSlot{{*}}key="w" {{*}}level=Proven
// # DEED: = PutModuleVariable
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
type Box = { w: number; h: number };
type Table = { scale: number };
let calls = 0;
function area(box: Box): number { return box.w * box.h; }
function checked(box: Box, scale: number): number { if (scale < 0) throw new RangeError("scale"); return area(box) * scale; }
function measured(box: Box): number { return checked(box, 2) + checked(box, 3); }
function counted(box: Box): number { calls++; return box.w; }
function sumOfMeasures(table: Table, times: number): number { const boxes: Box[] = []; for (let i = 0; i < 4; i++) boxes.push({ w: i + 1, h: i + 2 }); id(boxes[2]); let total = 0; for (let i = 0; i < times; i++) total += measured(boxes[i & 3]) * table.scale; return total; }
function sumOfCounted(table: Table, times: number, odd: boolean): number { const boxes: Box[] = []; for (let i = 0; i < 4; i++) boxes.push({ w: i + 1, h: i + 2 }); id(boxes[2]); if (odd) (0, eval)("Object.defineProperty(leaked, 'w', { get() { return 3; }, enumerable: true, configurable: true })"); let total = 0; for (let i = 0; i < times; i++) total += counted(boxes[i & 3]) * table.scale; return total; }
id(area); id(checked); id(measured); id(counted); id(sumOfMeasures); id(sumOfCounted);
report(sumOfMeasures(id({ scale: 2 }), 100));
report(sumOfMeasures((0, eval)("({ extra: 1, scale: 3 })"), 100));
report(sumOfCounted(id({ scale: 2 }), 100, false) + " " + calls);
report(sumOfCounted(id({ scale: 2 }), 100, true) + " " + calls);
report("end");
