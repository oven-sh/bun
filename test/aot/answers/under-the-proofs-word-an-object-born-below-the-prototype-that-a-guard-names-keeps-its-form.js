// answers: with-library
// # `new Point(..)` in a loop, Point a constructor function: behind a guard of the class the allocation names no prototype: the cell is born below the object that the class table has registered.
// # Where the guards are asked in front of the loop, the turns lean on what is remembered: that nothing in them stores another object under `prototype`, or lays a setter above a field that the allocation lists.
// # Under testing=CheckProofsAtRunTime, which --aot-harden=proof-checks stands for, the walk builds the same form, and beside it the conclusion is asked where the allocation stands:
// # what the function holds under `prototype` now, read off the function itself, is the object that the table names; the allocation lists its two stores, and their guards are asked again right in front of it. The process stops by name where either is false.
// # It used to build the construction as written there. That read is taken to write the guards, so every turn asked them anew, and a guard that was falsely remembered over a callee was never stale under the word.
// # f6 = quiet, f8 = entered
// # In a plain build the guards stand in front of the typed turns, and nothing of the construction is left in them.
// # RUN(PLAIN): walk f6 mechanisms=all
// # REQUIRES(PLAIN): entries-of-bun
// # PLAIN-LABEL: code f6:Body
// # PLAIN: = AreMembersUnchanged conditions=[{layout=L0 key="sum"}
// # PLAIN: isInLoop=true isLoopHead=true
// # PLAIN-NOT: = AreMembersUnchanged conditions=[{layout=L0 key="sum"}
// # PLAIN-NOT: = GetConstructPrototype
// # Under the word the turns are the same turns, with the checks beside them.
// # RUN(WORD): walk f6 mechanisms=all testing=CheckProofsAtRunTime
// # REQUIRES(WORD): entries-of-bun
// # WORD-LABEL: code f6:Body
// # WORD: isInLoop=true isLoopHead=true
// # WORD-NOT: = GetConstructPrototype
// # WORD: [[members]]: boolean @Boolean = AreMembersUnchanged conditions=[{kind=MemberPassedByStores layout=L0 key="x"}, {kind=MemberPassedByStores layout=L0 key="y"}]
// # WORD-NEXT: CheckProof [[members]] checkedType=true {{*}}source=WhatIsRemembered
// # WORD: = NewObject {{*}}layout=L0 fields=[0, 1]
// # WORD: = GetClassPrototype [[function]] layout=L0 traits
// # WORD-NEXT: CheckProof {{*}}source=OtherOperation
// # WORD-NEXT: = GetClassPrototype [[function]] layout=L0 [readsClassObjectItself]
// # WORD: [[same]]: boolean @Boolean = StrictEq
// # WORD-NEXT: CheckProof [[same]] checkedType=true {{*}}source=WhatIsRemembered
// # WORD-NOT: = GetConstructPrototype
// # The road on which the body is entered by a call and the allocation lists no store.
// # RUN(ENTERED): walk f8 mechanisms=all testing=CheckProofsAtRunTime
// # REQUIRES(ENTERED): entries-of-bun
// # ENTERED-LABEL: code f8:Body
// # ENTERED: isInLoop=true isLoopHead=true
// # ENTERED-NOT: = GetConstructPrototype
// # ENTERED: = NewObject layout=
// # ENTERED: = GetClassPrototype {{*}}[readsClassObjectItself]
// # Right programs go on under the word: the same object stored again under `prototype` ends the guard of that name and changes nothing; another object, or a setter above a field, sends the turns to the slow copy.
// # RUN(CHECKED): run-in-shell testing=CheckProofsAtRunTime mechanisms=all $SHELL
// # REQUIRES(CHECKED): entries-of-bun
// # CHECKED: 12 of 12 of 12
// # CHECKED-NEXT: exited with 0
// # A lie: the guards in front of the loops are taken to hold, so the typed turns go on behind another object under `prototype`. Under the word the process stops by name.
// # RUN(LIE): run-in-shell mechanisms=all testing=CheckProofsAtRunTime,GuardsAndFactsAreTakenToHold $SHELL
// # REQUIRES(LIE): entries-of-bun
// # LIE: AOT: f{{*}} at {{*}}: what memory holds where the compiler remembers another value is not of the type that the compiler has proven of it.
// # LIE: crashed with
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 12 of 12 of 12
// # CHECK-NEXT: exited with 0
const unseen = x => [x][JSON.parse("0")];
const hidden = JSON.parse('{"prototype":"prototype","x":"x","define":"defineProperty"}');
const numbers = [];
for (let k = 0; k < 300; k++) numbers.push(k & 3);
let seen = 0;
function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.sum = function () { return this.x + this.y; };
function Pair(x, y) { this.x = x; this.y = y; }
Pair.prototype.sum = function () { return this.x + this.y; };
function Wide(x) { this.x = x; for (let k = 0; k < 2; k++) this.x = (this.x + k) | 0; }
Wide.prototype.sum = function () { return this.x; };
function lay(holder, laid) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; holder[hidden.prototype] = laid; return work; }
function layAbove(holder) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; unseen(Object)[hidden.define](holder[hidden.prototype], hidden.x, { set(value) { seen++; }, get() { return 500; }, configurable: true }); return work; }
function quiet(list) { let total = 0; for (let i = 0; i < list.length; i++) { const p = new Point(list[i] | 0, 1); total = (total + p.sum()) | 0; } return total; }
function pairs(list, again, above, holder, laid) { let total = 0; for (let i = 0; i < list.length; i++) { const p = new Pair(list[i] | 0, 1); total = (total + p.sum()) | 0; if (i === again) lay(holder, laid); if (i === above) layAbove(holder); } return total; }
function entered(list) { let total = 0; for (let i = 0; i < list.length; i++) { const w = new Wide(list[i] | 0); total = (total + w.sum()) | 0; } return total; }
report(quiet(numbers));
lay(unseen(Point), unseen(Point.prototype));
report(quiet(numbers));
lay(unseen(Point), unseen({ sum() { return 1000; } }));
report(quiet(numbers));
report(pairs(numbers, -1, -1, null, null));
report(pairs(numbers, 100, -1, unseen(Pair), unseen(Pair.prototype)));
report(pairs(numbers, -1, 200, unseen(Pair), null));
report(pairs(numbers, -1, -1, null, null));
report(seen);
report(entered(numbers));
lay(unseen(Wide), unseen(Wide.prototype));
report(entered(numbers));
lay(unseen(Wide), unseen({ sum() { return 1000; } }));
report(entered(numbers));
report("end");
