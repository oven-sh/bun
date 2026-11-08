// answers: without-library
// # A loop is built twice. In its typed copy a test that nobody expects to fail, and that fails while nothing of the turn was done, begins the turn again in the other copy: no closed arm, nothing comes back.
// # So the looks at that copy count what such tests prove as proven, the turns run no other code, and a test that answers the same in every turn is asked once, in front of the loop, with the read behind it.
// # f1 = id, f2 = area, f3 = calledField, f4 = deedBehind, f5 = deedInFront, f6 = sumOfAreas
// # RUN(FORM): walk f3 f5 f6 mechanisms=all-ParameterGuards
// # FORM-LABEL: code f3:Body
// # The look at the slot, the read behind it and the compare with the one function that was seen at the field stand in blocks that are in no loop.
// # FORM: [[look]]: boolean @Boolean = IsSlotFilled {{*}}key="handler"
// # FORM-NEXT: Branch [[look]] -> taken [[filled]](), notTaken [[other]]()
// # FORM: [[filled]]():
// # FORM-NEXT: [[loaded]]: {{*}} = GetSlot {{*}}key="handler"
// # FORM-NEXT: [[isTheFunction]]: boolean @Boolean = TypeTest [[loaded]] testedType=f
// # FORM-NEXT: Branch [[isTheFunction]] -> taken [[called]](), notTaken [[other]]()
// # FORM: [[called]]():
// # FORM: = IsSlotFilled {{*}}key="bias"
// # FORM-LABEL: code f5:Body
// # A deed stands in front of the test: the turn may not begin again, so the closed read stays. The turn itself makes the box: the read is one operation, with the read by name inside it.
// # FORM: = PutModuleVariable
// # FORM: = GetSlot{{*}}key="value" {{*}}level=Expected
// # FORM-LABEL: code f6:Body
// # What a turn expects of a parameter of the head is asked of what enters, once, and the sum goes round as a number.
// # FORM: [[isNumber]]: boolean @Boolean = TypeTest {{*}}testedType=number
// # FORM-NEXT: Branch [[isNumber]] ->
// # FORM: number @Double{{*}}isInLoop=true isLoopHead=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
type Table = { handler: (x: number) => number; bias: number };
type Box = { value: number };
let deeds = 0;
function calledField(table: Table, times: number): number { let sum = 0; for (let i = 0; i < times; i++) sum = (table.handler(sum) + table.bias) | 0; return sum; }
function deedBehind(boxes: Box[], times: number): number { let total = 0; for (let i = 0; i < times; i++) { total += boxes[i & 3].value; deeds++; } return total; }
function deedInFront(boxes: Box[], times: number): number { let total = 0; for (let i = 0; i < times; i++) { deeds++; total += boxes[i & 3].value; } return total; }
function area(box: { w: number; h: number }): number { return box.w * box.h; }
function sumOfAreas(start: number, times: number): unknown { let total = start; for (let i = 0; i < times; i++) total += area({ w: i, h: 3 }); return total; }
const table: Table = { handler: (x) => x + 3, bias: 1 };
id(table); id(calledField); id(area); id(sumOfAreas);
report(calledField(table, 100));
id(table); (0, eval)("leaked.bias = 2.5"); report(calledField(table, 100));
(0, eval)("leaked.bias = '7'"); report(calledField(table, 3));
(0, eval)("leaked.bias = 1; leaked.handler = function (x) { return x - 1; }"); report(calledField(table, 100));
report(calledField((0, eval)("({ bias: 2, handler: function (x) { return x + 1; } })"), 100));
function boxesWithOneOdd(): Box[] { const boxes: Box[] = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }]; Object.defineProperty(id(boxes[2]), "value", { get() { return 30; }, enumerable: true, configurable: true }); return boxes; }
report(deedBehind(boxesWithOneOdd(), 100) + " " + deeds);
report(deedInFront(boxesWithOneOdd(), 100) + " " + deeds);
report([sumOfAreas(0, 10), sumOfAreas("s" as any, 3), sumOfAreas(0.5, 10), sumOfAreas(undefined as any, 2)].join(" "));
report("end");
