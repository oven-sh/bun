// answers: with-library
// # `if (thing.mark)`: a read by name of which nothing but its truth is asked, at the end of its block, outside of loops and of try: one call of one stub, which reads at the place and answers in the flags.
// # Every value under the name, found in the object, above it, behind a getter, a proxy, in a bag of names, on a primitive; no name at all; a receiver that has no properties; a getter that throws; a name that Object.prototype gains and loses.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 1163 of 1163 of 1163
// # CHECK-NEXT: exited with 0
function asks(thing) { if (thing.mark) return "yes"; return "no"; }
function asksNot(thing) { if (!thing.mark) return "not"; return "is"; }
function picks(thing) { return thing.mark ? "first" : "second"; }
function asksBoth(thing) { if (thing.mark && thing.other) return "both"; return "not both"; }
function asksEither(thing) { if (thing.mark || thing.other) return "either"; return "neither"; }
function asksTwice(thing) { if (thing.mark) { if (thing.mark) return "twice"; return "once"; } return "never"; }
function asksInside(thing) { try { if (thing.mark) return "yes inside"; return "no inside"; } catch (error) { return "caught inside " + error.constructor.name; } }
function counts(things) { let marked = 0; for (let at = 0; at < things.length; at++) { if (things[at].mark) marked++; } return marked; }
function follows(link) { let steps = 0; while (link.next) { link = link.next; steps++; } return steps; }
function asksLength(thing) { if (thing.length) return "long"; return "empty"; }
function asksDeep(thing) { if (thing.inner.mark) return "deep"; return "shallow"; }
function asksStray(thing) { if (thing.stray) return "stray"; return "none"; }
function tell(ask, thing) { try { return ask(thing); } catch (error) { return error.constructor.name + ": " + (typeof error.message === "string" && error.message.length > 0); } }
let asked = 0;
class Plain { constructor(mark) { this.mark = mark; this.other = 1; } }
class Above { get mark() { asked++; return this.hidden; } constructor(hidden) { this.hidden = hidden; } }
class Below extends Above { }
class Throws { get mark() { asked++; throw new RangeError("no mark"); } }
function withOwnGetter(value) { return Object.defineProperty({ other: 0 }, "mark", { get() { asked++; return value; }, configurable: true }); }
function withSetterAlone() { return Object.defineProperty({}, "mark", { set(value) { asked++; } }); }
function inherited(value) { return Object.create({ mark: value }); }
function inheritedTwice(value) { return Object.create(Object.create({ mark: value, other: value })); }
function behindProxy(value) { return new Proxy({ mark: value }, { get(target, key) { asked++; return target[key]; } }); }
function manyNames(value) { const bag = {}; for (let at = 0; at < 80; at++) bag["name" + at] = at; bag.mark = value; for (let at = 0; at < 70; at++) delete bag["name" + at]; return bag; }
function deleted(value) { const thing = { mark: value, other: 2 }; delete thing.mark; return thing; }
function addedLate(value) { const thing = { other: 3 }; thing.mark = value; return thing; }
function withoutPrototype(value) { const thing = Object.create(null); thing.mark = value; return thing; }
const base = { };
function belowBase(value) { const thing = Object.create(base); thing.other = value ? 4 : 5; return thing; }
class BelowBase { constructor(value) { this.other = value ? 4 : 5; } }
Object.setPrototypeOf(BelowBase.prototype, base);
const strayName = JSON.parse('"stray"');
function withStray(value) { const thing = { other: 6 }; thing[strayName] = value; return thing; }
function strayAbove(value) { return Object.create(withStray(value)); }
function strayBehindGetter(value) { return Object.defineProperty({ other: 7 }, strayName, { get() { asked++; return value; }, configurable: true }); }
function strayBehindProxy(value) { return new Proxy(withStray(value), { get(target, key) { asked++; return target[key]; } }); }
function strayLost(value) { const thing = withStray(value); delete thing[strayName]; return thing; }
function strayInBag(value) { const bag = manyNames(0); bag[strayName] = value; return bag; }
function driveStray() { for (const maker of [withStray, strayAbove, strayBehindGetter, strayBehindProxy, strayLost, strayInBag]) { let line = ""; for (const value of values) line += tell(asksStray, maker(value)) + ","; report(line); } let line = ""; for (const other of others) line += tell(asksStray, other) + ","; report(line); report(asked); }
function named() { }
named.mark = 0;
const values = [undefined, null, false, true, 0, -0, NaN, 1, 0.5, -1, 2147483648, "", "a", 0n, 1n, Symbol.iterator, {}, [], named, new Boolean(false), new String("")];
const makers = [value => ({ mark: value }), value => ({ other: 1, mark: value }), value => new Plain(value), value => new Above(value), value => new Below(value), withOwnGetter, inherited, inheritedTwice, behindProxy, manyNames, deleted, addedLate, withoutPrototype, belowBase, value => new BelowBase(value), value => Object.freeze({ mark: value }), value => [value], value => Object.assign([], { mark: value }), value => Object.assign(function () { }, { mark: value })];
const others = [undefined, null, true, 0, 1.5, "", "text", 1n, Symbol.iterator, {}, [], named, new Throws(), withSetterAlone(), new Map(), /x/, new Date(0), Object.prototype, Function.prototype];
const readers = [asks, asksNot, picks, asksBoth, asksEither, asksTwice, asksInside, asksLength];
function drive() { for (const reader of readers) { for (const maker of makers) { let line = ""; for (const value of values) line += tell(reader, maker(value)) + ","; report(line); } let line = ""; for (const other of others) line += tell(reader, other) + ","; report(line); } report(asked); }
drive();
drive();
base.mark = 1;
drive();
base.mark = 0;
drive();
delete base.mark;
Object.defineProperty(base, "mark", { get() { asked++; return this.other === 4; }, configurable: true });
drive();
delete base.mark;
drive();
Object.setPrototypeOf(base, { mark: "above the base" });
drive();
driveStray();
driveStray();
base[strayName] = 1;
driveStray();
report(tell(asksStray, belowBase(1)));
delete base[strayName];
report(tell(asksStray, belowBase(1)));
report(counts([{ mark: 1 }, { mark: 0 }, {}, new Above("x"), behindProxy(1), "text", 5]));
report(follows({ next: { next: { next: { next: null } } } }));
report(follows({ next: { next: inherited(0) } }));
report(tell(follows, { next: undefined }));
report(tell(asksDeep, { inner: { mark: 1 } }));
report(tell(asksDeep, { inner: {} }));
report(tell(asksDeep, {}));
report(tell(asksDeep, { inner: null }));
report(asked);
report("end");
