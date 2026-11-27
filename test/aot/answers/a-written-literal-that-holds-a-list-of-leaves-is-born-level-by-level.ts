// answers: without-library
// # `[[1, 2, 3], [4, 5, 6]]`, `{ a: ["x"], b: ["y"] }` written in a function or in a loop: the front end made ONE record of data of a written literal however nested, and over sixteen nodes the run time walked that record anew at every evaluation: five to twenty times what plain Bun takes.
// # Where the literal may run again and a list of leaves lies inside it, each level above that list is born by code and the list stays data of its own: one cell around storage that is shared until somebody writes. Records in records, and a list that holds leaves beside a record, stay one record of data as before.
// # Every evaluation gives new lists: what is written into one (a store, push, pop, reverse, unshift, length, freeze) shows in no other.
// # f1 = ofNumbers, f2 = ofTexts, f3 = ofRecords, f4 = recordRoot, f5 = threeDeep, f6 = oddOnes, f7 = recordsAlone, f8 = listWithRecord, f9 = inLoop, f10 = ofPairs
// # RUN(LEVELS): walk f1 f2 f3 f4 f5 mechanisms=all
// # LEVELS-LABEL: code f1:Body
// # LEVELS-COUNT-3: encoding=CopyOnWriteArray
// # LEVELS: = NewArray
// # LEVELS-LABEL: code f2:Body
// # LEVELS-COUNT-2: encoding=CopyOnWriteArray
// # LEVELS-LABEL: code f3:Body
// # The program stores elements into v of ofRecords and a of recordRoot: such a list is born with storage of its own.
// # LEVELS-COUNT-4: encoding=TreeWithOwnStorage
// # LEVELS-LABEL: code f4:Body
// # LEVELS: encoding=TreeWithOwnStorage
// # LEVELS-COUNT-5: encoding=CopyOnWriteArray
// # LEVELS-LABEL: code f5:Body
// # LEVELS-COUNT-6: encoding=CopyOnWriteArray
// # RUN(NOTREE): walk f1 f2 f3 f4 f5 f9 mechanisms=all
// # NOTREE-NOT: encoding=ReadOnlyTree
// # RUN(ASBEFORE): walk f8 mechanisms=all
// # ASBEFORE-COUNT-1: encoding=ReadOnlyTree
// # ASBEFORE-NOT: = NewArray
// # The only argument of a construction stays one record: `new Map([[1, "a"], [2, "b"]])` is made of it without a list.
// # RUN(PAIRS): walk f10 mechanisms=all
// # PAIRS: = NewMapFromData
// # PAIRS-NOT: = NewArray
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 32 of 32 of 32
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=none $SHELL
// # ALSO1: 32 of 32 of 32
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function ofNumbers() { return [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], [13, 14, 15]]; }
function ofTexts() { return [["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"], ["b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9"]]; }
function ofRecords() { return [{ k: "a", v: ["b", "c", "d"] }, { k: "e", v: ["f", "g", "h"] }, { k: "i", v: ["j", "k", "l"] }, { k: "m", v: ["n"] }]; }
function recordRoot() { return { a: ["a", "b"], b: ["c", "d"], c: ["e", "f"], d: ["g", "h"], e: ["i", "j"], length: 5, f: ["k", "l"] }; }
function threeDeep() { return [[[1, 2], [3, 4]], [[5, 6], [7, 8]], [[9, 10], [11, 12]], "end"]; }
function oddOnes() { return [[], [1, , 3], [undefined, null], [1.5, -0], [true, "t", 7n], [[]]]; }
function recordsAlone() { return { height: 10, style: { color: "red", bold: true }, more: { a: { b: { c: 1 } } } }; }
function listWithRecord() { return [["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", { x: 1 }], "a"]; }
function inLoop(turns: number) { let sum = 0; for (let turn = 0; turn < turns; turn++) { const made = [[turn & 0, 1, 2], [3, 4, 5]]; const written = [[10, 20, 30], [40, 50, 60], [70, 80, 90], [1, 2, 3], [4, 5, 6]]; written[turn % 5]![0] = turn; sum += made[1]![2]! + written[0]![0]! + written[4]![2]!; } return sum; }
function ofPairs() { const held = new Map([[1, "a"], [2, "b"], [3, "c"]]); held.set(9, "z"); return held.size + held.get(2)!; }
function show(value: unknown): string { return JSON.stringify(value, (key, held) => typeof held === "bigint" ? held + "n" : held === undefined ? "undefined" : held); }
report(show(ofNumbers()));
report(show(ofTexts()));
report(show(ofRecords()));
report(show(recordRoot()));
report(show(threeDeep()));
report(show(oddOnes()));
report(show(recordsAlone()));
report(show(listWithRecord()));
report(inLoop(7));
report(ofNumbers() === ofNumbers());
report(ofNumbers()[0] === ofNumbers()[0]);
report(ofRecords()[1]!.v === ofRecords()[1]!.v);
report(recordRoot().c === recordRoot().c);
report(1 in oddOnes()[1]!);
report(oddOnes()[1]!.length);
report(Object.is(oddOnes()[3]![1], -0));
report(oddOnes()[0]!.length + oddOnes()[5]!.length);
const numbers = ofNumbers();
numbers[0]![0] = 99;
numbers[1]!.push(100);
numbers[2]!.length = 1;
numbers.push([0]);
report(show(numbers));
report(show(ofNumbers()));
const texts = ofTexts();
texts[1]![9] = "changed";
texts[0]!.reverse();
report(show(texts));
report(show(ofTexts()));
const records = ofRecords();
records[0]!.v[0] = "changed";
records[0]!.k = "changed";
records[3]!.v.pop();
report(show(records));
report(show(ofRecords()));
const root = recordRoot();
root.f.unshift("first");
(root.a as unknown[])[1] = { other: true };
report(show(root));
report(show(recordRoot()));
const deep = threeDeep();
(deep[2] as number[][])[1]![1] = 1.5;
report(show(deep));
report(show(threeDeep()));
const frozen = Object.freeze(ofNumbers()[0]!);
report(Object.isFrozen(frozen));
report(Object.isFrozen(ofNumbers()[0]!));
report(ofPairs());
report(ofPairs());
report("end");
