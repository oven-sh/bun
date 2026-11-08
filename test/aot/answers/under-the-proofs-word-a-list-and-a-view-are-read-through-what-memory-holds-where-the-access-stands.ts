// answers: with-library
// # What a turn of a loop reads a list or a view through is a proof like any other: where the storage lies, how long it is, of which kind. A plain build asks in front of the loop and takes pointer, length and kind into the turns.
// # Under testing=CheckProofsAtRunTime, which --aot-harden=proof-checks stands for, the walk builds the same forms, and each access reads all three where it stands and stops by name where what it was told is false.
// # A length that is a value of the program, as the bound of the loop is, is read in the turn.
// # f1 = sumOfList, f2 = addOne, f3 = sumOfView, f4 = turnsOf
// # In a plain build the length of the list that for-of steps through stands in front of the head.
// # RUN(PLAIN): walk f4 mechanisms=all
// # REQUIRES(PLAIN): entries-of-bun
// # PLAIN-LABEL: code f4:Body
// # PLAIN: = GetArrayLength
// # PLAIN: isLoopHead=true
// # PLAIN-NOT: = GetArrayLength
// # RUN(TURN): walk f4 mechanisms=all testing=CheckProofsAtRunTime
// # REQUIRES(TURN): entries-of-bun
// # TURN-LABEL: code f4:Body
// # TURN-NOT: = GetArrayLength
// # TURN: isLoopHead=true
// # TURN: = GetArrayLength
// # The forms stay: the kind is asked in front, the accesses are told the kind and that they lie inside.
// # RUN(FORMS): walk f2 mechanisms=all testing=CheckProofsAtRunTime
// # REQUIRES(FORMS): entries-of-bun
// # FORMS-LABEL: code f2:Body
// # FORMS: = HasArrayStorage
// # FORMS: = GetArrayElement {{*}}arrayStorage={{*}}isInBounds
// # No range check is left out, of a list or of a view.
// # RUN(COUNTS): compile RangeChecksRemoved mechanisms=all testing=CheckProofsAtRunTime
// # REQUIRES(COUNTS): entries-of-bun
// # COUNTS: RangeChecksRemoved 0
// # RUN: run-in-shell $SHELL testing=CheckProofsAtRunTime
// # REQUIRES: entries-of-bun
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function sumOfList(list: number[]): number { let sum = 0; for (let k = 0; k < list.length; k++) sum += list[k]; return sum; }
function addOne(list: number[]): number { for (let k = 0; k < list.length; k++) list[k] = (list[k] + 1) & 1023; return list[0]; }
function sumOfView(view: Float64Array): number { let sum = 0; for (let k = 0; k < view.length; k++) sum += view[k]; return sum; }
function turnsOf(list: number[]): number { let turns = 0; for (const each of list) turns += each > 0 ? 1 : 2; return turns; }
const whole: number[] = [];
const halves: number[] = [];
for (let at = 0; at < 40; at++) { whole.push(at); halves.push(at + 0.5); }
const view = new Float64Array(40).fill(1.5);
report(sumOfList(whole)); report(sumOfList(halves)); report(addOne(whole)); report(sumOfList(whole)); report(sumOfView(view)); report(turnsOf(whole)); report(turnsOf(halves)); report(turnsOf([]));
report("end");
