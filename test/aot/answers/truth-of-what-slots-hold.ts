// answers: without-library
// # the truth of a field of a class, asked four ways, of objects as they are made and of objects into whose field code that nobody sees has stored every kind of value, or whose field it has deleted, laid above them or made an accessor
// # f1 = hasNext, f2 = lacksNext, f3 = nextOrSelf, f4 = bothNext
// # the run that shows the form is walk/guesses/truth-of-a-field-of-a-class-is-asked-of-the-word.ir, which waits for held slots. These answers hold with the form and without it
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 89 of 89 of 89
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO1: 89 of 89 of 89
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO2: 89 of 89 of 89
// # ALSO2-NEXT: exited with 0
declare function report(value: unknown): void;
class Item { next: Item | undefined; label: string; constructor(label: string, next: Item | undefined) { this.label = label; this.next = next; } }
function hasNext(item: Item) { const size = item.label.length; if (item.next) return size + 1; return size; }
function lacksNext(item: Item) { const size = item.label.length; if (!item.next) return size + 1; return size; }
function nextOrSelf(item: Item) { const size = item.label.length; return (item.next ? "next" : "self") + size; }
function bothNext(item: Item, other: Item) { const size = item.label.length; if (item.next && other.next) return size + 1; return size; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function tellAll(item: Item) { tell(() => hasNext(item)); tell(() => lacksNext(item)); tell(() => nextOrSelf(item)); tell(() => bothNext(item, item)); }
const hidden = JSON.parse('{"set":"set","define":"defineProperty","remove":"deleteProperty","above":"setPrototypeOf"}');
const last = new Item("a", undefined);
tellAll(last);
tellAll(new Item("bc", last));
const stored: unknown[] = [null, 0, -0, NaN, "", "x", 5, 0.5, true, false, 0n, 1n, Symbol.iterator, [], () => 0];
for (let i = 0; i < stored.length; i++) { const item = new Item("s" + i, last); (Reflect as any)[hidden.set](item, "next", stored[i]); tellAll(item); }
const removed = new Item("removed", last);
(Reflect as any)[hidden.remove](removed, "next");
tellAll(removed);
const below = new Item("below", last);
(Reflect as any)[hidden.remove](below, "next");
(Reflect as any)[hidden.above](below, { next: 1, label: "above" });
tellAll(below);
let reads = 0;
const watched = new Item("watched", undefined);
(Reflect as any)[hidden.define](watched, "next", { get() { reads++; return reads & 1; }, configurable: true });
tellAll(watched);
report(reads);
const back = new Item("back", last);
(Reflect as any)[hidden.set](back, "next", 7);
(Reflect as any)[hidden.set](back, "next", last);
tellAll(back);
tell(() => hasNext(undefined as any));
tell(() => hasNext(JSON.parse('{"label":"parsed","next":0}')));
tell(() => hasNext(JSON.parse('{"label":"parsed","next":{}}')));
report("end");
