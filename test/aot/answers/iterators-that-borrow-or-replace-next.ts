// answers: with-library
// # The step asks the function that the open has read whether it is the next of the engine: a next of its own, one on the prototype, one that wraps the engine s, the engine s on what is no generator, and what is stored or deleted while the loop runs.
// # At the end the shell runs the same text itself: every answer is the same.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 29 of 29 of 29
// # CHECK-NEXT: exited with 0
function* count(limit: number): Generator<number> { for (let number = 0; number < limit; number++) yield number; }
function collect(given: unknown) { const iterable = given as Generator<unknown>; const seen: string[] = []; try { for (const value of iterable) seen.push(String(value)); } catch (error: any) { seen.push(error.name); } return seen.join(", "); }
const enginesNext = count(0).next;
report(collect({ [Symbol.iterator]() { return this; }, next: enginesNext }));
report(collect({ [Symbol.iterator]() { return { next: enginesNext }; } }));
report(collect({ [Symbol.iterator]() { return Object.create(count(3)); } }));
report(collect({ [Symbol.iterator]() { return new Proxy(count(3), {}); } }));
report(collect({ [Symbol.iterator]() { return [].values(); } }));
report(collect({ [Symbol.iterator]() { return count(3); } }));
report(collect({ [Symbol.iterator]: () => count(2) }));
class Bag { items: string[]; constructor(...items: string[]) { this.items = items; } *[Symbol.iterator]() { yield* this.items; } }
report(collect(new Bag("x", "y")));
const ownNext: any = count(3);
let calls = 0;
ownNext.next = function () { calls++; return calls > 2 ? { done: true } : { done: false, value: "own " + calls }; };
report(collect(ownNext));
function* replaced() { yield "never seen"; }
(replaced as any).prototype.next = function () { return { done: true, value: "from the prototype" }; };
report(collect(replaced()));
function* wrapped() { yield 1; yield 2; }
(wrapped as any).prototype.next = function (this: any, value: any) { const result = enginesNext.call(this, value); return result.done ? result : { done: false, value: result.value * 100 }; };
report(collect(wrapped()));
const changedInLoop: Generator<number> = count(4);
const seenWhileChanging: number[] = [];
for (const value of changedInLoop) { seenWhileChanging.push(value); (changedInLoop as any).next = () => ({ done: true }); }
report(seenWhileChanging.join());
const deletedInLoop: Generator<number> = count(3);
(deletedInLoop as any).next = function (this: any, value: any) { return enginesNext.call(this, value); };
const seenWhileDeleting: number[] = [];
for (const value of deletedInLoop) { seenWhileDeleting.push(value); delete (deletedInLoop as any).next; }
report(seenWhileDeleting.join());
const otherIterator: any = count(3);
otherIterator[Symbol.iterator] = function () { return ["from", "a", "list"][Symbol.iterator](); };
report(collect(otherIterator));
function* hidden() { yield 1; }
(hidden as any).prototype[Symbol.iterator] = function () { return count(2); };
report(collect(hidden()));
function leaveEarly(iterable: Generator<unknown>) { for (const value of iterable) return "left at " + value; return "ran out"; }
const ownReturn: any = count(3);
ownReturn.return = function () { report("own return"); return {}; };
report(leaveEarly(ownReturn));
report(collect(ownReturn));
const badReturn: any = count(3);
badReturn.return = function () { return 1; };
try { report(leaveEarly(badReturn)); } catch (error: any) { report(error.name); }
const reparented = count(3);
Object.setPrototypeOf(reparented, { next() { return { done: true }; }, [Symbol.iterator]() { return this; } });
report(collect(reparented));
const orphan = count(3);
Object.setPrototypeOf(orphan, null);
report(collect(orphan));
function* withNullPrototype() { yield "found through the realm's prototype"; }
(withNullPrototype as any).prototype = null;
report(collect(withNullPrototype()));
function* withListPrototype() { yield 1; }
(withListPrototype as any).prototype = ["a", "b"];
report(collect(withListPrototype()));
report(collect({ [Symbol.iterator]() { return this; }, next() { return 1; } }));
report(collect({ [Symbol.iterator]() { return this; }, turns: 0, next() { return { get done() { return false; }, get value() { throw new EvalError("value"); } }; } }));
let turns = 0;
report(collect({ [Symbol.iterator]() { return this; }, next() { return { done: ++turns > 2 ? "yes" : 0, value: turns }; } })); // @ts-expect-error
const foreign = loadString("(function* () { yield 'from'; yield 'elsewhere'; })");
report(collect(foreign()));
report(collect({ [Symbol.iterator]() { return this; }, next: foreign().next }));
report("end");
declare function report(value: unknown): void;
