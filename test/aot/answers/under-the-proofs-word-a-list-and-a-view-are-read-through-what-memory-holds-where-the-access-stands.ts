// answers: with-library
// # What a turn of a loop reads a list or a view through is a proof like any other: where the storage lies, how long it is, of which kind. A plain build asks in front of the loop and takes pointer, length and kind into the turns.
// # Under testing=CheckProofsAtRunTime, which --aot-harden=proof-checks stands for, and under testing=TestsEveryPosition, which --aot-harden=ignore-told-ranges stands for, the walk builds the same records at the same places:
// # a net that builds another form than the one that ships can never stop a false word of the form that ships.
// # Each access reads pointer, length and kind of the cell where it stands, holds what it was told against them, and stops by name where they differ.
// # A length that is a value of the program, as the bound of the loop is, is read again in the turn and held against the one in front.
// # f1 = sumOfList, f2 = addOne, f3 = sumOfView, f4 = turnsOf
// # In a plain build the length of the list that for-of steps through stands in front of the head.
// # RUN(PLAIN): walk f4 mechanisms=all
// # REQUIRES(PLAIN): entries-of-bun
// # PLAIN-LABEL: code f4:Body
// # PLAIN: = GetArrayLength
// # PLAIN: isLoopHead=true
// # PLAIN-NOT: = GetArrayLength
// # Under either word the pointer stands there too, the read names it, and the length is asked again in the turn.
// # RUN(TURN): walk f4 mechanisms=all testing=CheckProofsAtRunTime
// # REQUIRES(TURN): entries-of-bun
// # TURN-LABEL: code f4:Body
// # TURN: [[storage]]: {{*}} = GetArrayStorage [[list]] traits
// # TURN-NEXT: [[kind]]: {{*}} = HasArrayStorage [[list]] arrayStorage=Double traits
// # TURN: isInLoop=true isLoopHead=true
// # TURN: = GetArrayLength [[list]] traits
// # TURN: = CheckProof {{*}} source=WhatIsRemembered
// # TURN: = GetArrayElement [[list]], {{*}}, [[storage]], [[kind]] arrayStorage={{*}}isInBounds
// # RUN(POSITIONS): walk f4 mechanisms=all testing=TestsEveryPosition
// # REQUIRES(POSITIONS): entries-of-bun
// # POSITIONS-LABEL: code f4:Body
// # POSITIONS: [[storage]]: {{*}} = GetArrayStorage [[list]] traits
// # POSITIONS-NEXT: [[kind]]: {{*}} = HasArrayStorage [[list]] arrayStorage=Double traits
// # POSITIONS: isInLoop=true isLoopHead=true
// # POSITIONS: = GetArrayLength [[list]] traits
// # POSITIONS: = CheckProof {{*}} source=WhatIsRemembered
// # POSITIONS: = GetArrayElement [[list]], {{*}}, [[storage]], [[kind]] arrayStorage={{*}}isInBounds
// # The same of a view: length and vector in front, the length asked again, the read names the vector.
// # RUN(VIEW): walk f3 mechanisms=all testing=CheckProofsAtRunTime
// # REQUIRES(VIEW): entries-of-bun
// # VIEW-LABEL: code f3:Body
// # VIEW: = GetTypedArrayLength [[view]] typedArrayType
// # VIEW: [[vector]]: {{*}} = GetTypedArrayVector [[view]] traits
// # VIEW: isLoopHead=true
// # VIEW: = GetTypedArrayLength [[view]] typedArrayType
// # VIEW: = CheckProof {{*}} source=WhatIsRemembered
// # VIEW: = GetTypedArrayElement [[view]], {{*}}, [[vector]] typedArrayType={{*}}isInsideView
// # What the emitter lays in front of an access that names its storage: the pointer of the cell, read through a name that no load in front answers for, and a stop where it is another.
// # RUN(HELD): emit f1 mechanisms=all testing=TestsEveryPosition
// # REQUIRES(HELD): entries-of-bun
// # HELD: @[[told]] = Load(@[[list]], {{*}}JSArray_butterfly
// # HELD: = Opaque(@[[list]],
// # HELD: = Equal(@[[told]], @
// # RUN(VECTOR): emit f3 mechanisms=all testing=TestsEveryPosition
// # REQUIRES(VECTOR): entries-of-bun
// # VECTOR: @[[asked]] = Opaque(
// # VECTOR-NEXT: @[[inCell]] = Load(@[[asked]], {{*}}JSArrayBufferView_vector
// # VECTOR-NEXT: = Equal({{*}}, @[[inCell]],
// # The forms stay: the kind is asked in front, the accesses are told the kind and that they lie inside.
// # RUN(FORMS): walk f2 mechanisms=all testing=CheckProofsAtRunTime
// # REQUIRES(FORMS): entries-of-bun
// # FORMS-LABEL: code f2:Body
// # FORMS: = HasArrayStorage
// # FORMS: = GetArrayElement {{*}}arrayStorage={{*}}isInBounds
// # Whether its list holds fractions a read is told as well: the read asks the cell anew, and stops where the two answers differ.
// # RUN(KINDS): compile KindsToldToReadsHeldAgainstCells mechanisms=all testing=TestsEveryPosition
// # REQUIRES(KINDS): entries-of-bun
// # KINDS: KindsToldToReadsHeldAgainstCells 2
// # No range check is left out, of a list or of a view.
// # RUN(COUNTS): compile RangeChecksRemoved mechanisms=all testing=CheckProofsAtRunTime
// # REQUIRES(COUNTS): entries-of-bun
// # COUNTS: RangeChecksRemoved 0
// # RUN: run-in-shell $SHELL testing=CheckProofsAtRunTime
// # REQUIRES: entries-of-bun
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
// # RUN(BOTH): run-in-shell $SHELL testing=CheckProofsAtRunTime,TestsEveryPosition
// # REQUIRES(BOTH): entries-of-bun
// # BOTH: 9 of 9 of 9
// # BOTH-NEXT: exited with 0
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
