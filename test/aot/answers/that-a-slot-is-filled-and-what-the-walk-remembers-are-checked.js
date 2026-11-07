// answers: without-library
// # The program of filled-field-and-a-constructor-that-returns-early.ir, with the proofs checked at run time.
// # readA(): that every construction fills `a` is Link's word. The test stands in front of the read, and the process ends where it fails.
// # addToB(): `return p.b` is answered by what was stored a line above, which is the walk's own belief. The read is built as well and held against what was remembered.
// # A sum may be NaN, which is not itself: the two are the same where they compare equal and each is itself, or where neither is itself. `half.b + 1` is NaN, and the program runs to its end.
// # OPTIONS: testing=CheckProofsAtRunTime
// # RUN(FILLED): walk f1 mechanisms=all
// # FILLED: [[isFilled]]: boolean @Boolean = IsSlotFilled {{*}}key="a"
// # FILLED-NEXT: = CheckProof [[isFilled]] checkedType=true {{*}}source=Field
// # FILLED-NEXT: = GetSlot {{*}}key="a"
// # RUN(REMEMBERED): walk f4 mechanisms=all
// # REMEMBERED: [[sum]]: {{*}} = Add
// # REMEMBERED: = PutSlotOrAdd
// # REMEMBERED: [[read]]: {{*}} = GetSlot {{*}}key="b"
// # REMEMBERED: [[found]]: {{*}} = Box [[read]]
// # REMEMBERED: [[remembered]]: {{*}} = Box [[sum]]
// # REMEMBERED: = StrictEq [[found]], [[remembered]]
// # REMEMBERED-COUNT-2: = CheckProof {{*}}checkedType=true {{*}}source=WhatIsRemembered
// # REMEMBERED: Return
// # In the constructor, what the walk remembers of the cell that it has made: no flag in the order word, the layout's prototype, the keys listed so far. Each store that may list a key leans on all three, and they are tested again in front of it.
// # RUN(CELL): walk f5 mechanisms=all
// # CELL: [[made]]: {{*}} = NewObject
// # CELL: [[flags]]: boolean @Boolean = IsNotFrozen [[made]] [hasNoExtraProperties, hasNoFieldOutsideSlot]
// # CELL-NEXT: = CheckProof [[flags]] checkedType=true {{*}}source=WhatIsRemembered
// # CELL: = HasLayoutPrototype [[made]]
// # CELL: = HasKeyOrder [[made]] layout=L0
// # CELL: = PutSlotOrAdd [[made]], {{*}}key="a"
// # CELL: = HasKeyOrder [[made]] layout=L0 fields=[0]
// # CELL: = PutSlotOrAdd [[made]], {{*}}key="b"
// # RUN(RUNS): run-in-shell globalThis.report = value => print(String(value));
// # RUNS: NaN
// # RUNS: end
// # RUNS: exited with 0
class P { constructor(v) { this.a = 1; if (v) return; this.b = 2; } }
function readA(p) { return p.a; }
function readB(p) { return p.b; }
function hasB(p) { return "b" in p; }
function addToB(p) { p.b = p.b + 1; return p.b; }
const whole = new P(false);
const half = new P(true);
report(readA(whole));
report(readA(half));
report(readB(whole));
report(readB(half));
report(hasB(whole));
report(hasB(half));
report(addToB(whole));
report(addToB(half));
report(hasB(half));
report("end");
