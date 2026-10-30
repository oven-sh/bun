const lines = [];
function show(name, ...values) { lines.push(name + ": " + values.join(" ")); }
function describe(object, F) {
  const above = Object.getPrototypeOf(object);
  return [above === F.prototype, above === Object.prototype, object instanceof F, object.constructor === F, typeof object.greet === "function" ? object.greet() : String(object.greet)].join(",");
}
function many(make) { let last; for (let i = 0; i < 3000; i++) last = make(i); return last; }

function Alone(x) { this.x = x; }
Alone.prototype.greet = function () { return "alone" + this.x; };
show("alone", describe(many(i => new Alone(i)), Alone));

function Bare(x) { this.x = x; }
const bare = many(i => new Bare(i));
show("bare", Object.getPrototypeOf(bare) === Object.prototype, Object.getPrototypeOf(Object.getPrototypeOf(bare)) === Object.prototype, bare.x, Object.keys(bare).join());

function Stored(x) { this.x = x; }
const storedEarly = many(i => new Stored(i));
Stored.prototype = { greet() { return "stored"; } };
show("stored", describe(storedEarly, Stored), describe(many(i => new Stored(i)), Stored));

function Aliased(x) { this.x = x; }
const alias = [Aliased][0];
const aliasedEarly = many(i => new Aliased(i));
alias.prototype = { greet() { return "aliased"; } };
show("aliased", describe(aliasedEarly, Aliased), describe(many(i => new Aliased(i)), Aliased));

function give(fn, object) { fn.prototype = object; }
function Given(x) { this.x = x; }
function GivenToo(x) { this.x = x; }
const givenEarly = many(i => new Given(i));
give(Given, { greet() { return "given"; } });
give(GivenToo, { greet() { return "given too"; } });
show("given", describe(givenEarly, Given), describe(many(i => new Given(i)), Given), describe(many(i => new GivenToo(i)), GivenToo));

function Keyed(x) { this.x = x; }
const keyedEarly = many(i => new Keyed(i));
Keyed[["proto", "type"].join("")] = { greet() { return "keyed"; } };
show("keyed", describe(keyedEarly, Keyed), describe(many(i => new Keyed(i)), Keyed));

function Defined(x) { this.x = x; }
const definedEarly = many(i => new Defined(i));
Object.defineProperty(Defined, "prototype", { value: { greet() { return "defined"; } } });
show("defined", describe(definedEarly, Defined), describe(many(i => new Defined(i)), Defined));
function Reflected(x) { this.x = x; }
const reflectedEarly = many(i => new Reflected(i));
Reflect.set(Reflected, "prototype", { greet() { return "reflected"; } });
show("reflected", describe(reflectedEarly, Reflected), describe(many(i => new Reflected(i)), Reflected));
function Copied(x) { this.x = x; }
const copiedEarly = many(i => new Copied(i));
Object.assign(Copied, { prototype: { greet() { return "copied"; } } });
show("copied", describe(copiedEarly, Copied), describe(many(i => new Copied(i)), Copied));

function Emptied(x) { this.x = x; }
const emptiedEarly = many(i => new Emptied(i));
Emptied.prototype = null;
const emptiedLate = many(i => new Emptied(i));
show("emptied", Object.getPrototypeOf(emptiedEarly) === Object.prototype, Object.getPrototypeOf(emptiedLate) === Object.prototype);

function LentFirst(x) { this.x = x; } function TakesFirst(y) { this.y = y; }
LentFirst.prototype.greet = function () { return "lent"; };
TakesFirst.prototype = LentFirst.prototype;
const takenFirst = many(i => new TakesFirst(i)), lentFirst = many(i => new LentFirst(i));
show("lent, taker first", describe(lentFirst, LentFirst), describe(takenFirst, TakesFirst), lentFirst instanceof TakesFirst, takenFirst instanceof LentFirst);
function LentSecond(x) { this.x = x; } function TakesSecond(y) { this.y = y; }
LentSecond.prototype.greet = function () { return "lent"; };
TakesSecond.prototype = LentSecond.prototype;
const lentSecond = many(i => new LentSecond(i)), takenSecond = many(i => new TakesSecond(i));
show("lent, taker second", describe(lentSecond, LentSecond), describe(takenSecond, TakesSecond), lentSecond instanceof TakesSecond, takenSecond instanceof LentSecond);
function LentNever(x) { this.x = x; } function TakesNever(y) { this.y = y; }
TakesNever.prototype = LentNever.prototype;
const lentNever = many(i => new LentNever(i));
show("lent, taker never", describe(lentNever, LentNever), lentNever instanceof TakesNever);
function LentByKey(x) { this.x = x; } function TakesByKey(y) { this.y = y; }
const holders = { one: TakesByKey };
holders.one[["proto", "type"].join("")] = LentByKey.prototype;
const takenByKey = many(i => new TakesByKey(i)), lentByKey = many(i => new LentByKey(i));
show("lent by key", describe(lentByKey, LentByKey), describe(takenByKey, TakesByKey), lentByKey instanceof TakesByKey, takenByKey instanceof LentByKey);

const base = { greet() { return "base"; }, get late() { return "late of base"; } };
function Relinked(x) { this.x = x; }
const relinkedEarly = many(i => new Relinked(i));
show("relinked before", String(relinkedEarly.late), String(relinkedEarly.greet));
Object.setPrototypeOf(Relinked.prototype, base);
show("relinked", relinkedEarly.late, describe(many(i => new Relinked(i)), Relinked));
function RelinkedByStore(x) { this.x = x; }
RelinkedByStore.prototype.__proto__ = base;
show("relinked by a store", many(i => new RelinkedByStore(i)).late, describe(many(i => new RelinkedByStore(i)), RelinkedByStore));

function Named(x) { this.x = x; }
const named = many(i => new Named(i));
function readLate(o) { return o.late; }
let before = 0; for (let i = 0; i < 3000; i++) if (readLate(named) === undefined) before++;
Named.prototype.late = "late";
show("named", before, readLate(named));
function NamedByKey(x) { this.x = x; }
const namedByKey = many(i => new NamedByKey(i));
function readLater(o) { return o.later; }
before = 0; for (let i = 0; i < 3000; i++) if (readLater(namedByKey) === undefined) before++;
NamedByKey.prototype[["la", "ter"].join("")] = "later";
show("named by key", before, readLater(namedByKey));
let seen = 0;
function Watched(x) { this.x = x; }
const watchedEarly = many(i => new Watched(i));
Object.defineProperty(Watched.prototype, "x", { set(value) { seen++; }, get() { return "from the getter"; } });
const watchedLate = many(i => new Watched(i));
show("watched", watchedEarly.x, watchedLate.x, seen, Object.keys(watchedLate).length);
let seenEarly = 0;
function WatchedFromTheStart(x) { this.x = x; }
Object.defineProperty(WatchedFromTheStart.prototype, "x", { set(value) { seenEarly++; } });
show("watched from the start", String(many(i => new WatchedFromTheStart(i)).x), seenEarly);
function ReadOnlyAbove(x) { this.x = x; }
Object.defineProperty(ReadOnlyAbove.prototype, "x", { value: "fixed", writable: false });
try { show("read-only above", many(i => new ReadOnlyAbove(i)).x); } catch (error) { show("read-only above", error.constructor.name); }

function OnItself(x) { this.x = x; }
OnItself.call(OnItself.prototype, "on the prototype");
const onItself = many(i => new OnItself(i));
delete onItself.x;
show("on itself", onItself.x);

function Target(x) { this.x = x; }
function Other() {}
Other.prototype.greet = function () { return "other"; };
class Below extends Target { greet() { return "below"; } }
show("new.target", describe(many(i => Reflect.construct(Target, [i], Other)), Other), describe(many(i => new Below(i)), Below), describe(many(i => new Target(i)), Target), new Below(1) instanceof Target);

function Moved(x) { this.x = x; }
Object.setPrototypeOf(Moved, { [Symbol.hasInstance]() { return "yes"; }, extra: 1 });
show("moved", many(i => new Moved(i)) instanceof Moved, ({}) instanceof Moved, Moved.extra);

function factory() { return function Made(x) { this.x = x; }; }
const MadeOne = factory(), MadeTwo = factory();
MadeTwo.prototype.greet = function () { return "two"; };
show("made twice", describe(many(i => new MadeOne(i)), MadeOne), describe(many(i => new MadeTwo(i)), MadeTwo), new MadeOne(1) instanceof MadeTwo);

function Printed(x) { this.x = x; }
show("printed", Bun.inspect(new Printed(1)), Bun.inspect(Printed), JSON.stringify(many(i => new Printed(i))));

console.log(lines.join("\n"));
