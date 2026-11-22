// answers: without-library
// # `shelf` is written as `{}` and filled with getters under names that Link does not see (a loop over the names of another object). `shelf.rate` and `shelf.step` are read in a loop:
// # the walk guesses that the names are absent from the empty layout; the looks fail at every turn, so the closed arm runs at every turn though it is laid as rare code.
// # In a loop that arm keeps the answers at its sites, as the closed reads would have had them without the guess: the generic read by name costs 28 instructions more a read.
// # f1 = turn, f2 = fill, f3 = rate, f4 = step
// # RUN(FORM): bytes f1:Body
// # FORM-LABEL: unit f1:Body
// # FORM: ReadAtSiteAskingStructureFirst.OfAnyValueUnderNameOfField under (SiteCache {{*}}"rate"
// # FORM: ReadAtSiteAskingStructureFirst.OfAnyValueUnderNameOfField under (SiteCache {{*}}"step"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
var define = Object.defineProperty;
var fill = (target: any, all: any) => { for (var name in all) define(target, name, { get: all[name], enumerable: true, configurable: true }); };
var rate = 3, step = 5;
var shelf: any = {};
fill(shelf, { rate: () => rate, step: () => step });
function turn(t: number) { let s = t & 1; for (let i = 0; i < 100; i++) s = (s + shelf.rate + shelf.step) | 0; return s; }
var sum = 0;
for (var t = 0; t < 50; t++) sum = (sum + turn(t)) % 1000003;
report(sum);
rate = 7;
report(turn(1));
fill(shelf, { rate: () => step, step: () => rate * 2 });
report(turn(2));
report("end");
