// answers: without-library
// # a read behind `i < list.length` that looks at no length answers as the read with its own test: for no element, one, many, holes, a list that a call in the turn cuts, empties, lengthens or makes holes in
// # beside it stand the tests that hold nothing: the end let in, the length of another list, a call or a step between the test and the read, a start below zero, a length that was read in front of the loop
// # f5 = countsInside, f6 = countsBesideACall, f7 = letsTheEndIn, f8 = asksAnotherList, f9 = callsBetween, f10 = stepsBetween, f11 = mayStartBelowZero, f12 = keepsAnOldLength, f13 = testsOnce, f14 = testsTheOtherWayRound
// # RUN(FORM): walk f6 mechanisms=all
// # FORM-LABEL: code f6:Body
// # FORM: = GetArrayElement {{*}}isInBounds
// # RUN(CLEAN): walk f5 mechanisms=all
// # CLEAN-LABEL: code f5:Body
// # CLEAN: = GetArrayElement {{*}}isInBounds
// # RUN(ROUND): walk f14 mechanisms=all
// # ROUND-LABEL: code f14:Body
// # ROUND: = GetArrayElement {{*}}isInBounds
// # RUN(OTHER): walk f8 mechanisms=all
// # OTHER-NOT: isInBounds
// # RUN(BELOW): walk f11 mechanisms=all
// # BELOW-NOT: isInBounds
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 145 of 145 of 145
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO1: 145 of 145 of 145
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO2: 145 of 145 of 145
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-Folding $SHELL
// # ALSO3: 145 of 145 of 145
// # ALSO3-NEXT: exited with 0
// # RUN(ALSO4): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO4: 145 of 145 of 145
// # ALSO4-NEXT: exited with 0
declare function report(value: unknown): void;
function countsInside(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) n += list[i] === undefined ? 1 : 0; return n; }
function countsBesideACall(list: string[], touch: (at: number) => void): number { let n = 0; for (let i = 0; i < list.length; i++) { n += list[i] === undefined ? 1 : 0; touch(i); } return n; }
function letsTheEndIn(list: string[], touch: (at: number) => void): number { let n = 0; for (let i = 0; i <= list.length; i++) { n += list[i] === undefined ? 1 : 0; touch(i); } return n; }
function asksAnotherList(list: string[], other: string[], touch: (at: number) => void): number { let n = 0; for (let i = 0; i < other.length; i++) { n += list[i] === undefined ? 1 : 0; touch(i); } return n; }
function callsBetween(list: string[], touch: (at: number) => void): number { let n = 0; for (let i = 0; i < list.length; i++) { touch(i); n += list[i] === undefined ? 1 : 0; } return n; }
function stepsBetween(list: string[], touch: (at: number) => void): number { let n = 0; for (let i = 0; i < list.length; ) { i += 3; n += list[i] === undefined ? 1 : 0; touch(i); } return n; }
function mayStartBelowZero(list: string[], from: number, touch: (at: number) => void): number { let n = 0; for (let i = from | 0; i < list.length; i++) { n += list[i] === undefined ? 1 : 0; touch(i); } return n; }
function keepsAnOldLength(list: string[], touch: (at: number) => void): number { const end = list.length; let n = 0; for (let i = 0; i < end; i++) { n += list[i] === undefined ? 1 : 0; touch(i); } return n; }
function testsOnce(list: string[], at: number): number { const i = at | 0; if (i >= 0 && i < list.length) return list[i] === undefined ? 1 : 0; return -1; }
function testsTheOtherWayRound(list: string[]): number { let n = 0; for (let i = 0; list.length > i; i++) n += list[i] === undefined ? 1 : 0; return n; }
(globalThis as any).kept = [countsInside, countsBesideACall, letsTheEndIn, asksAnotherList, callsBetween, stepsBetween, mayStartBelowZero, keepsAnOldLength, testsOnce, testsTheOtherWayRound];
const kept = (globalThis as any).kept;
function texts(count: number): any { const list: any = JSON.parse("[]"); for (let i = 0; i < count; i++) list[i] = "t" + i; return list; }
function holed(): any { const list = texts(6); delete list[1]; delete list[4]; return list; }
function nothing(at: number) { }
function tell(run: () => unknown) { try { report(String(run())); } catch (error) { report((error as Error).name); } }
function withEach(run: (list: any, touch: (at: number) => void) => unknown) { tell(() => run(texts(0), nothing)); tell(() => run(texts(1), nothing)); tell(() => run(texts(8), nothing)); tell(() => run(holed(), nothing)); tell(() => { const list = texts(8); return run(list, at => { if (at === 1) list.length = 2; }); }); tell(() => { const list = texts(8); return run(list, at => { if (at === 1) list.length = 0; }); }); tell(() => { const list = texts(3); return run(list, at => { if (at === 1) list[40] = "far"; }); }); tell(() => { const list = texts(8); return run(list, at => { if (at === 2) delete list[3]; }); }); }
withEach(list => kept[0](list));
withEach((list, touch) => kept[1](list, touch));
withEach((list, touch) => kept[2](list, touch));
withEach((list, touch) => kept[3](list, texts(40), touch));
withEach((list, touch) => kept[3](list, list, touch));
withEach((list, touch) => kept[4](list, touch));
withEach((list, touch) => kept[5](list, touch));
withEach((list, touch) => kept[6](list, -3, touch));
withEach((list, touch) => kept[6](list, 0, touch));
withEach((list, touch) => kept[6](list, 2, touch));
withEach((list, touch) => kept[7](list, touch));
withEach(list => kept[8](list, -1));
withEach(list => kept[8](list, 0));
withEach(list => kept[8](list, 1));
withEach(list => kept[8](list, 7));
withEach(list => kept[8](list, 8));
withEach(list => kept[8](list, 4294967296));
withEach(list => kept[9](list));
report("end");
