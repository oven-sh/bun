// Array.from(items, mapper) over a Set or a Map that is as its class makes it, with the mapper written at the call, is walked there: through the table, the mapper in the loop, onto a list that nobody else holds.
// Whatever is not as made goes the way of anything else. So each thing that a program can do to a Set, to what stands above it and to the walk itself is done here, and the answers are plain Bun's.
const say = (label: string, value: unknown) => console.log(label, JSON.stringify(value, (_, each) => (Object.is(each, -0) ? "-0" : typeof each === "number" && each !== each ? "NaN" : each === undefined ? "undefined" : each)));
function doubled(items: Set<number>): number[] { return Array.from(items, value => value * 2); }
function numbered(items: Set<string>): string[] { return Array.from(items, (value, index) => index + ":" + value); }
function joined(items: Map<string, number>): string[] { return Array.from(items, ([key, value], index) => index + key + "=" + value); }
function underThis(items: Set<number>, holder: { add: number }): number[] { return Array.from(items, function (this: { add: number }, value) { return value + this.add; }, holder); }
function asTheyAre(items: Set<unknown>): unknown[] { return Array.from(items, value => value); }
function thenDo(items: Set<number>, atIndex: number, then: () => void): number[] { return Array.from(items, (value, index) => { if (index === atIndex) then(); return value; }); } // @ts-expect-error
function into(maker: any, items: Set<number>): any { return Array.from.call(maker, items, (value: number) => value + 1); }

say("a set", doubled(new Set([1, 2, 3])));
say("no members", doubled(new Set()));
say("the index", numbered(new Set(["a", "b", "c"])));
say("a map", joined(new Map([["x", 1], ["y", 2]])));
say("this", underThis(new Set([1, 2]), { add: 10 }));
say("every kind", asTheyAre(new Set<unknown>([0, -0, NaN, 1.5, "", "text", null, undefined, true, { a: 1 }, [1], 2 ** 40])));

const large = new Set<number>();
for (let each = 0; each < 200; each++) large.add(each);
for (let each = 0; each < 200; each += 3) large.delete(each);
const fromLarge = doubled(large);
say("large, with gaps", [fromLarge.length, fromLarge[0], fromLarge[1], fromLarge[fromLarge.length - 1], fromLarge.reduce((sum, each) => sum + each, 0)]);

const grows = new Set([1, 2]);
say("it grows under the walk", thenDo(grows, 0, () => { grows.add(3); grows.add(4); }));
const shrinks = new Set([1, 2, 3, 4]);
say("it shrinks under the walk", thenDo(shrinks, 1, () => { shrinks.delete(3); shrinks.delete(1); }));
const cleared = new Set([1, 2, 3]);
say("it is cleared under the walk", thenDo(cleared, 0, () => { cleared.clear(); }));
const filledAgain = new Set([1, 2, 3]);
say("cleared and filled again", thenDo(filledAgain, 0, () => { filledAgain.clear(); filledAgain.add(9); filledAgain.add(8); }));
const outgrown = new Set([0]);
say("it outgrows its table under the walk", thenDo(outgrown, 0, () => { for (let each = 1; each < 100; each++) outgrown.add(each); }).length);

const thrower = new Set([1, 2, 3]);
try { thenDo(thrower, 1, () => { throw new RangeError("at the second"); }); } catch (error) { say("the mapper throws", [(error as Error).name, (error as Error).message, thrower.size]); }

const made = doubled(new Set([1, 2]));
made.push(9);
say("what is made is a list", [Array.isArray(made), made.length, Object.getPrototypeOf(made) === Array.prototype, Object.keys(made), made]);

const key: symbol = Symbol.iterator;
const ownMethod = new Set([1, 2]);
(ownMethod as any)[key] = function* () { yield 30; yield 40; };
say("a method of its own", doubled(ownMethod));
const ownNothing = new Set([1, 2]);
(ownNothing as any)[key] = undefined;
say("nothing of its own under the symbol", doubled(ownNothing));
const likeList = new Set([1, 2]);
Object.assign(likeList, { [key]: null, length: 2, 0: 5, 1: 6 });
say("read as an object with a length", doubled(likeList));
const ownName = new Set([1, 2]);
(ownName as any).label = "named";
say("another name of its own", doubled(ownName));
class Odd extends Set<number> { *[Symbol.iterator](): any { yield 70; } }
class Plain extends Set<number> {}
say("classes below", [doubled(new Odd([1, 2])), doubled(new Plain([1, 2]))]);
const turned = new Set([1, 2]);
Object.setPrototypeOf(turned, { [Symbol.iterator]: function* () { yield 50; } });
say("another prototype", doubled(turned));
const frozen = Object.freeze(new Set([1, 2]));
say("frozen", doubled(frozen));
const laidInTheWalk = new Set([1, 2, 3]);
say("a method laid in the walk", [thenDo(laidInTheWalk, 0, () => { (laidInTheWalk as any)[key] = function* () { yield 60; }; }), thenDo(laidInTheWalk, -1, () => {})]);

class Shelf { length = 0; [index: number]: number; }
const shelf = into(Shelf, new Set([1, 2]));
say("into what another class constructs", [shelf instanceof Shelf, Array.isArray(shelf), shelf.length, shelf[0], shelf[1]]);
say("on what constructs nothing", [Array.isArray(into(() => {}, new Set([1]))), into(undefined, new Set([4]))]);
class Below extends Array<number> {}
const below = into(Below, new Set([1, 2]));
say("into a class below Array", [below instanceof Below, below.length, below[1]]);
class Sealed { constructor() { return Object.preventExtensions(this); } }
try { into(Sealed, new Set([1])); } catch (error) { say("what takes no property", (error as Error).name); }

let total = 0;
const turns = new Set([1, 2, 3, 4, 5]);
for (let turn = 0; turn < 400; turn++) total += doubled(turns).length + joined(new Map([["k", turn]])).length;
say("many turns", total);
