// The members of a class as a program sees them: their keys in order, their descriptors, their identity and their names, whoever looks at the class first and however: a list of keys, a call, a store, a deletion, a definition, a freeze, another prototype. The record of the class creates them, with the class or when one is first looked for.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Listed { first() { return 1; } get size() { return 2; } set size(v) { } second(a, b) { return 3; } static make() { return 4; } static get kind() { return 5; } }
report(Reflect.ownKeys(Listed.prototype).join());
report(Reflect.ownKeys(Listed).join());
const d1 = Object.getOwnPropertyDescriptor(Listed.prototype, "first");
report(typeof d1.value + " " + typeof d1.get + " " + typeof d1.set + " " + d1.writable + " " + d1.enumerable + " " + d1.configurable);
const d2 = Object.getOwnPropertyDescriptor(Listed.prototype, "size");
report(typeof d2.value + " " + typeof d2.get + " " + typeof d2.set + " " + d2.writable + " " + d2.enumerable + " " + d2.configurable);
const d3 = Object.getOwnPropertyDescriptor(Listed.prototype, "constructor");
report(typeof d3.value + " " + typeof d3.get + " " + typeof d3.set + " " + d3.writable + " " + d3.enumerable + " " + d3.configurable);
const d4 = Object.getOwnPropertyDescriptor(Listed, "make");
report(typeof d4.value + " " + typeof d4.get + " " + typeof d4.set + " " + d4.writable + " " + d4.enumerable + " " + d4.configurable);
const d5 = Object.getOwnPropertyDescriptor(Listed, "kind");
report(typeof d5.value + " " + typeof d5.get + " " + typeof d5.set + " " + d5.writable + " " + d5.enumerable + " " + d5.configurable);
const d6 = Object.getOwnPropertyDescriptor(Listed, "prototype");
report(typeof d6.value + " " + typeof d6.get + " " + typeof d6.set + " " + d6.writable + " " + d6.enumerable + " " + d6.configurable);
report(Listed.prototype.first === Listed.prototype.first);
report(new Listed().first === Listed.prototype.first);
report(Listed.prototype.constructor === Listed);
report(Listed.prototype.first.name + " " + Listed.prototype.second.length + " " + Listed.make.name + " " + Object.getOwnPropertyDescriptor(Listed.prototype, "size").get.name);
class Called { constructor(x) { this.x = x; } plus(y) { return this.x + y; } get twice() { return this.x * 2; } set twice(v) { this.x = v / 2; } static of(x) { return new Called(x); } }
const called = Called.of(3);
report(called.plus(1));
report(called.twice);
called.twice = 10;
report(called.x);
report(Object.keys(called).join());
class Stored { one() { return 1; } two() { return 2; } }
Stored.prototype.late = 26;
report(Reflect.ownKeys(Stored.prototype).join());
report(new Stored().one() + new Stored().late);
class StoredOnClass { static one() { return 1; } two() { return 2; } }
StoredOnClass.late = 26;
report(Reflect.ownKeys(StoredOnClass).join());
report(StoredOnClass.one() + StoredOnClass.late);
class Deleted { one() { return 1; } two() { return 2; } }
report(delete Deleted.prototype.one);
report(Reflect.ownKeys(Deleted.prototype).join());
report(typeof new Deleted().one);
class Replaced { old() { return "old"; } kept() { return "kept"; } }
const early = new Replaced();
report(early.old());
Replaced.prototype.old = function () { return "new"; };
report(early.old() + " " + early.kept());
class Redefined { get read() { return "getter"; } }
report(new Redefined().read);
Object.defineProperty(Redefined.prototype, "read", { value: "value", configurable: true });
report(new Redefined().read);
class Caught { constructor() { this.plain = 1; this.caught = 2; } set caught(v) { report("caught " + v); } get caught() { return "by the getter"; } method() { return "method"; } }
const caught = new Caught();
report(Object.keys(caught).join());
report(caught.caught);
caught.method = "own";
report(caught.method + " " + Object.keys(caught).join() + " " + new Caught().method());
class Twice { m() { return "early"; } get v() { return "got"; } m() { return "late"; } set v(x) { } get w() { return "getter"; } w() { return "method"; } }
report(Reflect.ownKeys(Twice.prototype).join());
report(new Twice().m() + " " + new Twice().v + " " + new Twice().w());
const d7 = Object.getOwnPropertyDescriptor(Twice.prototype, "v");
report(typeof d7.value + " " + typeof d7.get + " " + typeof d7.set + " " + d7.writable + " " + d7.enumerable + " " + d7.configurable);
const d8 = Object.getOwnPropertyDescriptor(Twice.prototype, "w");
report(typeof d8.value + " " + typeof d8.get + " " + typeof d8.set + " " + d8.writable + " " + d8.enumerable + " " + d8.configurable);
const middle = String(1);
class Mixed { a() { return 1; } [middle]() { return 2; } b() { return 3; } static name() { return "named"; } static length() { return "long"; } static c() { return 4; } }
report(Reflect.ownKeys(Mixed.prototype).join());
report(Reflect.ownKeys(Mixed).join());
report(new Mixed().a() + new Mixed()[middle]() + new Mixed().b() + Mixed.name() + Mixed.length() + Mixed.c());
class Base { who() { return "base"; } both() { return "both"; } get up() { return "base up"; } static tell() { return "static base"; } }
class Derived extends Base { who() { return "derived over " + super.who(); } get up() { return "derived " + super.up; } static tell() { return "static derived over " + super.tell(); } }
class Leaf extends Derived { }
report(new Leaf().who() + ", " + new Leaf().both() + ", " + new Leaf().up + ", " + Leaf.tell());
report(Object.getPrototypeOf(Leaf) === Derived);
report(Object.getPrototypeOf(Derived.prototype) === Base.prototype);
report(Object.getPrototypeOf(Base.prototype) === Object.prototype);
report(Reflect.ownKeys(Leaf.prototype).join() + " " + Reflect.ownKeys(Derived.prototype).join());
class Frozen { m() { return 1; } static s() { return 2; } }
Object.freeze(Frozen.prototype);
Object.freeze(Frozen);
report(Object.isFrozen(Frozen.prototype) + " " + Object.isFrozen(Frozen) + " " + new Frozen().m() + " " + Frozen.s());
const d9 = Object.getOwnPropertyDescriptor(Frozen.prototype, "m");
report(typeof d9.value + " " + typeof d9.get + " " + typeof d9.set + " " + d9.writable + " " + d9.enumerable + " " + d9.configurable);
class Moved { where() { return "first"; } }
const moved = new Moved();
Object.setPrototypeOf(moved, { where() { return "moved"; } });
report(moved.where() + " " + new Moved().where());
Object.setPrototypeOf(Moved.prototype, { below() { return "from below"; } });
report(new Moved().below());
function counter(start) { let n = start; return class Counter { constructor() { n++; } count() { return n; } get doubled() { return n * 2; } static reset() { n = start; } }; }
const CountA = counter(10);
const CountB = counter(20);
new CountA();
new CountA();
new CountB();
report(new CountA().count() + " " + new CountB().count() + " " + new CountA().doubled);
report(CountA.prototype.count === CountB.prototype.count);
CountA.reset();
report(CountA.prototype.count() + " " + CountB.prototype.count());
report(Reflect.ownKeys(CountA.prototype).join() + " " + Reflect.ownKeys(CountA).join());
class Loose { pick() { return this === undefined ? "none" : this.v; } static pick() { return typeof this; } }
const pick = Loose.prototype.pick;
report(pick() + " " + (0, Loose.pick)() + " " + Loose.pick());
class Asked { a() { } }
report("a" in Asked.prototype);
report("b" in Asked.prototype);
report("a" in new Asked());
report(Object.hasOwn(Asked.prototype, "a"));
report(Object.hasOwn(new Asked(), "a"));
class Hot { constructor(n) { this.n = n; } add(k) { return this.n + k; } get twice() { return this.n * 2; } }
let sum = 0;
for (let i = 0; i < 1000; i++) { const hot = new Hot(i); sum += hot.add(1) + hot.twice; }
report(sum);
report("end");
