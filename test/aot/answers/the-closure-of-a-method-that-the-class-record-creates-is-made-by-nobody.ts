// answers: with-library
// # In a body that is written straight a DefineMethod emits nothing where the record of the class creates the member. The closure that it names was
// # made all the same, by a stub, and read by nobody; it waited in the result register, the next operation stored it, and its word of the frame was
// # listed to be given back at a place that lay behind already: the word was held to the end of the unit. Files that define classes are such bodies:
// # every method cost a closure at the start of the program. Now such a DefineMethod takes one read off its function, and what nobody reads is not made.
// # `plain` has six members that the record creates. `mixed` has members that it does not create: a key that is computed, and methods that hold a
// # variable of the function round them. Each evaluation of a class makes members of its own.
// # plain is written once for each of its two calls: f4 = the copy of the first
// # OPTIONS: testing=ForceStraightCompilation
// # RUN(STRAIGHT): compile StraightUnitsCompiled mechanisms=all
// # STRAIGHT-NOT: statistic StraightUnitsCompiled 0
// # RUN(FRAME): bytes f4:Body mechanisms=all
// # REQUIRES(FRAME): x86_64 as-written
// # FRAME: frame=0@
// # RUN: run-in-shell $SHELL
// # CHECK: 16 of 16 of 16
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
interface Start { start: number; }
function parse(at: number): Start { return JSON.parse('{"start":' + at + "}"); }
function plain(from: Start): any { class Five { one() { return 1; } two() { return 2; } three() { return 3; } four() { return 4; } static five() { return 5; } get six() { return 6; } } (Five as any).start = from.start; return Five; }
function mixed(from: Start, key: string): any { let kept = 0; class Held { start() { return from.start; } [key]() { return "under " + key; } set keep(value: number) { kept = value + from.start; } get keep() { return kept; } static both() { return from.start + kept; } last() { return 9; } } return Held; }
const first = plain(parse(3));
const second = plain(parse(4));
const five = new first();
report(five.one() + five.two() * 10 + five.three() * 100 + five.four() * 1000 + first.five() * 10000 + five.six * 100000 + first.start * 1000000);
report(Object.getOwnPropertyNames(first.prototype).join());
report(Object.getOwnPropertyNames(first).join());
report(first.prototype.one === first.prototype.one);
report(first.prototype.one === second.prototype.one);
report(first.five === second.five);
report(first.prototype.one.name + first.prototype.two.length + second.start);
report(typeof Object.getOwnPropertyDescriptor(second.prototype, "six")!.get);
report(Object.getOwnPropertyDescriptor(first.prototype, "three")!.enumerable);
first.prototype.one.mark = "marked";
report(String(first.prototype.one.mark) + String(second.prototype.one.mark));
const held = mixed(parse(7), "named");
const other = mixed(parse(8), "other");
const one = new held();
report(one.start() + " " + one.named() + " " + one.last());
one.keep = 5;
report(one.keep + " " + held.both() + " " + other.both());
report(new other().start() + " " + new other().other() + " " + typeof new other().named);
report(Object.getOwnPropertyNames(held.prototype).join());
report(held.prototype.last === other.prototype.last);
report("end");
