// `[...kept]`, `f(...kept)` of an `arguments` object that has left its function. Where it is as made, the run time appends its elements out of its own storage. Whatever a program has done to it is heard.
const say = (label: string, value: unknown) => console.log(label, JSON.stringify(value, (_, each) => (each === undefined ? "undefined" : Object.is(each, -0) ? "-0" : each)));
function keepAll(..._: unknown[]): any { return arguments; }
// The list grows in a loop, so nobody knows how long it is: the call is a call, and what it answers is an object of the engine, not one that the compiler follows.
function keep(...values: unknown[]): any { const grown: unknown[] = []; for (const value of values) grown.push(value); return keepAll(...grown); }
const count = (...values: unknown[]) => values.length + ":" + values.join();
const spread = (kept: any): unknown[] => [...kept];
const between = (kept: any): unknown[] => [0, ...kept, 9, ...kept];
const holes = (list: unknown[]) => list.map((_, at) => at in list).join();

// What changes no structure comes first: the engine holds every such object for changed once one of them has got a name, lost an element or been asked for its method.
const gaps = keep("a", "b");
gaps[3] = "d";
gaps.length = 4;
say("a gap in front of a store past the end", [spread(gaps), holes(spread(gaps))]);
const cut = keep("a", "b", "c");
cut.length = 2;
say("texts, a shorter length", spread(cut));
const replaced = keep("a", "b");
replaced[0] = 7;
say("texts, one replaced by a number", spread(replaced));
say("as made", [spread(keep(1, 2, 3)), between(keep(1, 2)), count(...keep("a", "b"))]);
say("nothing in it", [spread(keep()), between(keep()), count(...keep())]);
say("every kind", spread(keep(0, -0, 1.5, "", "text", null, undefined, true, { a: 1 }, [1], 2 ** 40)));
const many: number[] = [];
for (let each = 0; each < 1000; each++) many.push(each);
const fromMany = spread(keep(...many));
say("many", [fromMany.length, fromMany[0], fromMany[999], (fromMany as number[]).reduce((sum, each) => sum + each, 0)]);

const withHole = keep(1, 2, 3);
delete withHole[1];
say("one is deleted", [spread(withHole), holes(spread(withHole)), count(...withHole)]);
const textsWithHole = keep("a", "b", "c");
delete textsWithHole[1];
say("one of three texts is deleted", [spread(textsWithHole), holes(spread(textsWithHole)), count(...textsWithHole)]);
const objectsWithHole = keep({ a: 1 }, { b: 2 });
delete objectsWithHole[0];
say("one of two objects is deleted", [spread(objectsWithHole), holes(spread(objectsWithHole)), 0 in spread(objectsWithHole)]);
const shorter = keep(1, 2, 3);
shorter.length = 2;
say("a shorter length", spread(shorter));
const longer = keep(1, 2);
longer.length = 4;
say("a longer length", [spread(longer), holes(spread(longer))]);
const oddLength = keep(1, 2, 3);
oddLength.length = "2";
say("a length that is a text", spread(oddLength));
const fraction = keep(1, 2, 3);
fraction.length = 1.5;
say("a length that is a fraction", spread(fraction));
const negative = keep(1, 2, 3);
negative.length = -1;
say("a negative length", spread(negative));
const stored = keep(1, 2, 3);
stored[0] = "changed";
stored[5] = "far";
say("stores by index", [spread(stored), stored.length]);
const ownMethod = keep(1, 2);
ownMethod[Symbol.iterator] = function* () { yield 40; };
say("a method of its own", [spread(ownMethod), count(...ownMethod)]);
const noMethod = keep(1, 2);
noMethod[Symbol.iterator] = undefined;
try { spread(noMethod); } catch (error) { say("no method", (error as Error).name); }
const named = keep(1, 2);
named.label = "named";
say("another name of its own", spread(named));
const getter = keep(1, 2, 3);
Object.defineProperty(getter, 1, { get() { return "got"; }, configurable: true, enumerable: true });
say("a getter under an index", spread(getter));
const frozen = Object.freeze(keep(1, 2));
say("frozen", spread(frozen));
const turned = keep(1, 2);
Object.setPrototypeOf(turned, { [Symbol.iterator]: function* () { yield 50; } });
say("another prototype", spread(turned));
const doubles = keep(1.5, 2.5);
say("fractions alone", spread(doubles));

const copy = spread(keep(1, 2));
copy.push(3);
say("what is made is a list of its own", [Array.isArray(copy), copy, copy.length]);
const source = keep(1, 2);
const taken = spread(source);
source[0] = 9;
say("the copy does not follow", [taken, spread(source)]);

let total = 0;
const turns = keep(1, 2, 3, 4, 5);
for (let turn = 0; turn < 400; turn++) total += spread(turns).length + between(turns).length;
say("many turns", total);
