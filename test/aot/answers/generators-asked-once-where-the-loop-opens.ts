// answers: without-library
// # a loop over what is written to be a generator, handed generators as they are made, started, ended, running, with names of their own, below another object, and what is no generator at all; names that a turn adds
// # f1 = count, f3 = total, f4 = firstTwo
// # LIBRARY: own
// # RUN(FORM): walk f3 mechanisms=all-ParameterGuards-Inlining
// # FORM: = IsUnmodifiedGenerator
// # FORM: = StepGenerator {{*}}check=None
// # RUN(CLOSE): walk f4 mechanisms=all-ParameterGuards-Inlining
// # CLOSE: = StepGenerator {{*}}resumeMode=Return{{*}}check=IsUnmodified
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 36 of 36 of 36
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO1: 36 of 36 of 36
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO2: 36 of 36 of 36
// # ALSO2-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
function* count(limit: number) { try { for (let i = 0; i < limit; i++) yield i; } finally { log += "f;"; } }
function* other() { yield 1; yield 2; }
function total(things: Generator<number>) { let sum = 0; for (const thing of things) sum += thing; return sum; }
function firstTwo(things: Generator<number>) { let sum = 0; let turns = 0; for (const thing of things) { sum += thing; if (++turns === 2) break; } return sum; }
function throwsInSecondTurn(things: Generator<number>) { let turns = 0; for (const thing of things) { if (++turns === 2) throw new RangeError("turn" + thing); } return turns; }
function closesByWhatATurnAdds(things: Generator<number>) { for (const thing of things) { (things as any).return = () => { log += "late;"; return {}; }; if (thing === 1) break; } return log; }
function stepsByWhatTheOpenRead(things: Generator<number>) { let sum = 0; for (const thing of things) { (things as any).next = () => ({ done: true, value: 0 }); sum += thing; } return sum; }
function stepsBesideTheLoop(things: Generator<number>) { let sum = 0; for (const thing of things) { sum += thing; things.next(); } return sum; }
function endsInATurn(things: Generator<number>) { let sum = 0; for (const thing of things) { sum += thing; things.return(0); if (sum > 50) break; } return sum; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name + ":" + log); } }
function withOwnNext() { const g = count(5); (g as any).next = () => ({ done: true, value: 7 }); return g; }
function withOwnReturn() { const g = count(5); (g as any).return = () => { log += "own;"; return {}; }; return g; }
function withReturnThatGivesNoObject() { const g = count(5); (g as any).return = () => 1; return g; }
function withOwnIterator() { const g = count(5); (g as any)[Symbol.iterator] = () => [7, 8][Symbol.iterator](); return g; }
function belowAnotherObject() { const g = count(5); Object.setPrototypeOf(g, { [Symbol.iterator]() { return [4][Symbol.iterator](); } }); return g; }
function byHand(limit: number) { let i = 0; return { [Symbol.iterator]() { return this; }, next() { return i < limit ? { done: false, value: i++ } : { done: true, value: undefined }; }, return() { log += "hand;"; return {}; } }; }
function started() { const g = count(5); g.next(); return g; }
function ended() { const g = count(1); g.next(); g.next(); return g; }
let self: Generator<number>;
function* eatsItself(): Generator<number> { for (const value of self) yield value; }
class Tree { size = 3; *[Symbol.iterator]() { for (let i = 0; i < this.size; i++) yield i * 2; } }
function totalOfTree(tree: Tree) { let sum = 0; for (const item of tree) sum += item; return sum; }
tell(() => total(count(4)));
for (let i = 0; i < 300; i++) total(count(3));
tell(() => total(count(0)));
tell(() => total(withOwnNext()));
tell(() => total(withOwnIterator()));
tell(() => total(belowAnotherObject()));
tell(() => total(byHand(4) as any));
tell(() => total([1, 2, 3] as any));
tell(() => total(new Set([5, 6]) as any));
tell(() => total(null as any));
tell(() => total(undefined as any));
tell(() => total(5 as any));
tell(() => total({} as any));
tell(() => total(started()));
tell(() => total(ended()));
log = "";
tell(() => firstTwo(count(5)));
report(log);
tell(() => firstTwo(withOwnReturn()));
report(log);
tell(() => firstTwo(withReturnThatGivesNoObject()));
tell(() => firstTwo(byHand(5) as any));
report(log);
tell(() => firstTwo(count(1)));
log = "";
tell(() => throwsInSecondTurn(count(5)));
tell(() => throwsInSecondTurn(withOwnReturn()));
tell(() => throwsInSecondTurn(withReturnThatGivesNoObject()));
tell(() => throwsInSecondTurn(byHand(5) as any));
log = "";
tell(() => closesByWhatATurnAdds(count(5)));
tell(() => stepsByWhatTheOpenRead(count(4)));
tell(() => stepsBesideTheLoop(count(6)));
tell(() => endsInATurn(count(6)));
self = eatsItself();
log = "";
tell(() => self.next().value);
tell(() => total(other()));
(other.prototype as any).next = function () { return { done: true, value: 0 }; };
tell(() => total(other()));
tell(() => totalOfTree(new Tree()));
tell(() => totalOfTree(new Tree()));
report("end");
