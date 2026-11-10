// answers: with-library
// # a list that a turn makes longer, shorter, of another kind or full of holes, by its own name, by another name, in a callee, a getter, a conversion, a handler, behind a wait or between two steps, is read as plain code reads it: nothing of it is kept from in front of the loop
// # each list comes out of JSON.parse and each function is called by value out of what unseen code holds
// # f4 = grows, f5 = storesBehindTheEnd, f6 = setsTheLength, f7 = empties, f8 = pops, f9 = shifts, f10 = takesAFraction, f11 = takesAnObject, f12 = losesAnElement, f13 = isWrittenThroughAnotherName, f14 = isChangedByACallee, f15 = isChangedByAGetter, f16 = isChangedByAConversion, f17 = takesAnotherList, f18 = isChangedByTheOuterTurn, f19 = isChangedInAHandler, f20 = storesIntoALiteral, f1 = literal, f21 = waits, f22 = hands
// # RUN(GROWS): walk f4 mechanisms=all
// # GROWS-NOT: = GetArrayStorage
// # RUN(CALLEE): walk f14 mechanisms=all
// # CALLEE-NOT: = GetArrayStorage
// # RUN(INNER): walk f18 mechanisms=all
// # INNER-LABEL: code f18:Body
// # INNER-NOT: = GetArrayStorage
// # INNER: isInLoop=true isLoopHead=true
// # INNER: = HasArrayStorage
// # INNER: = GetArrayStorage
// # RUN(WAITS): walk f21:CoroutineBody mechanisms=all
// # WAITS-NOT: = GetArrayStorage
// # RUN(HANDS): walk f22:CoroutineBody mechanisms=all
// # HANDS-NOT: = GetArrayStorage
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 118 of 118 of 118
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO1: 118 of 118 of 118
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO2: 118 of 118 of 118
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-Folding $SHELL
// # ALSO3: 118 of 118 of 118
// # ALSO3-NEXT: exited with 0
// # RUN(ALSO4): run-in-shell mechanisms=-Handlers $SHELL
// # ALSO4: 118 of 118 of 118
// # ALSO4-NEXT: exited with 0
declare function report(value: unknown): void;
function grows(list: number[], at: number): number { let s = 0; for (let i = 0; i < list.length && i < 14; i++) { s += list[i]; if (i === at) list.push(10, 20, 30, 40, 50, 60, 70, 80, 90); } return s; }
function storesBehindTheEnd(list: number[], at: number): number { let s = 0; for (let i = 0; i < list.length && i < 40; i++) { s += list[i] === undefined ? 1000 : list[i]; if (i === at) list[list.length + 20] = 5; } return s; }
function setsTheLength(list: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) list.length = 2; } return s; }
function empties(list: number[], at: number): number { let s = 0; for (let i = 0; i < 6; i++) { s += list[i] === undefined ? 1000 : list[i]; if (i === at) list.length = 0; } return s; }
function pops(list: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i >= at) list.pop(); } return s; }
function shifts(list: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) list.shift(); } return s; }
function takesAFraction(list: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) list[i + 1] = 0.5; } return s; }
function takesAnObject(list: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) (list as unknown[])[i + 1] = { valueOf() { return 100; } }; } return s; }
function losesAnElement(list: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i] === undefined ? 1000 : list[i]; if (i === at) delete list[i + 1]; } return s; }
function isWrittenThroughAnotherName(list: number[], other: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) other.length = 1; } return s; }
function isChangedByACallee(list: number[], change: () => void, at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) change(); } return s; }
function isChangedByAGetter(list: number[], holder: any, at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) s += holder.more; } return s; }
function isChangedByAConversion(list: number[], more: any, at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) s += more * 2; } return s; }
function takesAnotherList(list: number[], other: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) list = other; } return s; }
function isChangedByTheOuterTurn(list: number[], at: number): number { let s = 0; for (let k = 0; k < 5; k++) { for (let i = 0; i < list.length; i++) s += list[i]; list.push(k); if (k === at) list.length = 1; if (k === at + 1) list[0] = 0.5; } return s; }
function isChangedInAHandler(list: number[], box: any, at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { try { s += i === at ? box.inner.x : 0; } catch { list.length = 2; s += 1000; } s += list[i] === undefined ? 7000 : list[i]; } return s; }
function storesIntoALiteral(list: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i] + list[0]; if (i === at) list[0] = 50; } return s; }
function literal(): number[] { return [1, 2, 3, 4, 5, 6]; }
async function waits(list: number[], at: number): Promise<number> { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) await null; } return s; }
function* hands(list: number[]): Generator<number, number, unknown> { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; yield s; } return s; }
(globalThis as any).kept = [grows, storesBehindTheEnd, setsTheLength, empties, pops, shifts, takesAFraction, takesAnObject, losesAnElement, isWrittenThroughAnotherName, isChangedByACallee, isChangedByAGetter, isChangedByAConversion, takesAnotherList, isChangedByTheOuterTurn, isChangedInAHandler, storesIntoALiteral, waits, hands];
const kept = (globalThis as any).kept;
function fresh(): any { return JSON.parse("[1,2,3,4,5,6]"); }
function tell(run: () => unknown) { try { report(String(run())); } catch (error) { report((error as Error).name); } }
function each(run: (at: number) => unknown) { tell(() => run(99)); tell(() => run(0)); tell(() => run(2)); tell(() => run(5)); tell(() => run(99)); }
each(at => kept[0](fresh(), at));
each(at => kept[1](fresh(), at));
each(at => kept[2](fresh(), at));
each(at => kept[3](fresh(), at));
each(at => kept[4](fresh(), at));
each(at => kept[5](fresh(), at));
each(at => kept[6](fresh(), at));
each(at => kept[7](fresh(), at));
each(at => kept[8](fresh(), at));
each(at => { const list = fresh(); return kept[9](list, list, at); });
each(at => kept[9](fresh(), fresh(), at));
each(at => { const list = fresh(); return kept[10](list, () => { list.length = 1; }, at); });
each(at => { const list = fresh(); return kept[10](list, () => { list.push(7, 8, 9, 10, 11, 12, 13, 14, 15, 16); }, at); });
each(at => { const list = fresh(); return kept[10](list, () => { list[3] = "text"; }, at); });
each(at => { const list = fresh(); return kept[11](list, { get more() { list.length = 1; return 1000; } }, at); });
each(at => { const list = fresh(); return kept[12](list, { valueOf() { list.length = 1; return 500; } }, at); });
each(at => kept[13](fresh(), JSON.parse("[0.5,1.5]"), at));
each(at => kept[13](fresh(), JSON.parse("[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\",\"h\"]"), at));
each(at => kept[14](fresh(), at));
each(at => kept[15](fresh(), { inner: null }, at));
each(at => kept[16](literal(), at));
each(at => kept[16](literal(), at));
report(String(literal()[0]));
const waited = fresh();
const waiting = kept[17](waited, 1);
waited.length = 3;
report(String(await waiting));
const stepped = fresh();
const steps = kept[18](stepped);
report(String(steps.next().value));
stepped.length = 2;
report(String(steps.next().value));
stepped.push(0.5, "text");
report(String(steps.next().value));
report(String(steps.next().value));
report(String(steps.next().done));
report("end");
