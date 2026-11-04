// What a program can see of the members of a class, however and whenever they are made.
const out = [];
const say = (...words) => out.push(words.map(word => typeof word === "symbol" ? word.toString() : String(word)).join(" "));
const describe = (holder, key) => {
    const d = Object.getOwnPropertyDescriptor(holder, key);
    if (!d)
        return "none";
    return ["value" in d ? "value:" + typeof d.value : "get:" + typeof d.get + ",set:" + typeof d.set, d.writable, d.enumerable, d.configurable].join("|");
};

class Plain {
    constructor(x) { this.x = x; }
    first() { return "first" + this.x; }
    get size() { return this.x * 2; }
    set size(v) { this.x = v / 2; }
    second(a, b) { return a + b + this.x; }
    static make(x) { return new Plain(x); }
    static get kind() { return "plain"; }
}
say("keys", Reflect.ownKeys(Plain.prototype).join());
say("static keys", Reflect.ownKeys(Plain).join());
for (const key of Reflect.ownKeys(Plain.prototype))
    say(key, describe(Plain.prototype, key));
for (const key of Reflect.ownKeys(Plain))
    say("static", key, describe(Plain, key));
say(Plain.prototype.first === Plain.prototype.first, new Plain(1).first === Plain.prototype.first, Plain.prototype.constructor === Plain);
say(Plain.prototype.first.name, Plain.prototype.second.length, Plain.make.name, Object.getOwnPropertyDescriptor(Plain.prototype, "size").get.name, Object.getOwnPropertyDescriptor(Plain.prototype, "size").set.name);
say(Plain.make(3).first(), Plain.make(3).size, Plain.make(3).second(1, 2), Plain.kind);
{
    const p = new Plain(4);
    p.size = 10;
    say(p.x, Object.keys(p).join(), "size" in p, Object.hasOwn(p, "size"));
    for (const key in p)
        say("in", key);
}

// The order of keys with a computed name in the middle, and names that holders are made with.
const middle = "mid" + out.length % 1;
class Mixed {
    a() { return 1; }
    [middle]() { return 2; }
    b() { return 3; }
    static name() { return "named"; }
    static length() { return "long"; }
    static c() { return 4; }
    0() { return "zero"; }
    "constructor2"() { return 5; }
}
say(Reflect.ownKeys(Mixed.prototype).join(), Reflect.ownKeys(Mixed).join());
say(new Mixed().a(), new Mixed()[middle](), new Mixed().b(), Mixed.name(), Mixed.length(), Mixed.c(), new Mixed()[0](), new Mixed().constructor2());

// One name twice, and halves of an accessor apart.
class Twice {
    m() { return "early"; }
    get v() { return "got"; }
    m() { return "late"; }
    set v(x) { say("set", x); }
    get w() { return "getter"; }
    w() { return "method"; }
}
say(Reflect.ownKeys(Twice.prototype).join(), new Twice().m(), new Twice().v, describe(Twice.prototype, "v"), describe(Twice.prototype, "w"), new Twice().w());
new Twice().v = 7;

// Below another class, and through super.
class Base {
    constructor() { this.made = "base"; }
    who() { return "base"; }
    both() { return "base both"; }
    get up() { return "base up"; }
    static tell() { return "static base"; }
}
class Derived extends Base {
    who() { return "derived over " + super.who(); }
    get up() { return "derived " + super.up; }
    static tell() { return "static derived over " + super.tell(); }
}
class Leaf extends Derived { }
say(new Leaf().who(), new Leaf().both(), new Leaf().up, Leaf.tell(), new Leaf().made);
say(Object.getPrototypeOf(Leaf) === Derived, Object.getPrototypeOf(Derived.prototype) === Base.prototype, Object.getPrototypeOf(Base.prototype) === Object.prototype, Object.getPrototypeOf(Base) === Function.prototype);
say(new Leaf() instanceof Base, Reflect.ownKeys(Leaf.prototype).join(), Reflect.ownKeys(Derived.prototype).join());

// Changed behind the definition.
class Changed {
    keep() { return "kept"; }
    swap() { return "old"; }
    gone() { return "there"; }
    get reads() { return "getter"; }
}
const before = new Changed();
say(before.swap(), before.gone(), before.reads);
Changed.prototype.swap = function () { return "new"; };
delete Changed.prototype.gone;
Changed.prototype.added = function () { return "added"; };
Object.defineProperty(Changed.prototype, "reads", { value: "value now", configurable: true });
say(before.swap(), typeof before.gone, before.added(), before.reads, before.keep(), Reflect.ownKeys(Changed.prototype).join());
Object.setPrototypeOf(Changed.prototype, { below() { return "from below"; } });
say(before.below(), new Changed().below());

// A member above a store, declared and laid there later.
class Setter {
    constructor() { this.plain = 1; this.caught = 2; }
    set caught(v) { say("caught", v); }
    get caught() { return "by getter"; }
    method() { return "method"; }
}
const s = new Setter();
say(Object.keys(s).join(), s.caught, s.plain);
s.method = "own now";
say(s.method, Object.keys(s).join(), new Setter().method());
class ReadOnly { get fixed() { return 1; } }
try { "use strict"; (function () { "use strict"; new ReadOnly().fixed = 2; })(); say("no throw"); } catch (e) { say(e instanceof TypeError); }

// Frozen, sealed, listed.
class Frozen { m() { return 1; } static s() { return 2; } }
Object.freeze(Frozen.prototype);
Object.freeze(Frozen);
say(Object.isFrozen(Frozen.prototype), Object.isFrozen(Frozen), new Frozen().m(), Frozen.s(), describe(Frozen.prototype, "m"), describe(Frozen, "s"));
try { (function () { "use strict"; Frozen.prototype.m = 1; })(); say("no throw"); } catch (e) { say(e instanceof TypeError); }

// Members of other kinds.
class Kinds {
    *gen() { yield 1; yield 2; }
    async later() { return "later"; }
    async *stream() { yield "s"; }
    [Symbol.iterator]() { return [7, 8][Symbol.iterator](); }
    static [Symbol.hasInstance](v) { return v === 1; }
    #hidden() { return "hidden"; }
    shows() { return this.#hidden(); }
    static #count = 0;
    static next() { return ++Kinds.#count; }
    arrow = () => this.shows();
    static { say("static block", typeof this.next, Reflect.ownKeys(this.prototype).length); }
}
say([...new Kinds().gen()].join(), [...new Kinds()].join(), 1 instanceof Kinds, new Kinds().shows(), Kinds.next(), Kinds.next(), new Kinds().arrow());
say(Reflect.ownKeys(Kinds.prototype).map(String).join(), Reflect.ownKeys(Kinds).map(String).join());
new Kinds().later().then(v => { say(v); finish(); });

// A class that is evaluated again and again, over an environment.
function factory(tag) {
    return class Made {
        tagged() { return tag; }
        static tagOf() { return tag; }
        get both() { return tag + tag; }
    };
}
const One = factory("one"), Two = factory("two");
say(new One().tagged(), new Two().tagged(), One.tagOf(), Two.tagOf(), new One().both, One.prototype.tagged === Two.prototype.tagged, One === Two, One.name);
const classes = [];
for (let i = 0; i < 3; i++)
    classes.push(class { index() { return i; } static twice() { return i * 2; } });
say(classes.map(c => new c().index() + ":" + c.twice()).join(), classes[0].name === "", classes[0].prototype.index === classes[1].prototype.index);

// Members and constructor over one environment that they change.
function counter(start) {
    let n = start;
    return class Counter {
        constructor() { n++; }
        count() { return n; }
        get doubled() { return n * 2; }
        static reset() { n = start; }
    };
}
const CountA = counter(10), CountB = counter(20);
new CountA(); new CountA(); new CountB();
say(new CountA().count(), new CountB().count(), new CountA().doubled, CountA.prototype.count === CountB.prototype.count);
CountA.reset();
say(CountA.prototype.count(), CountB.prototype.count(), Reflect.ownKeys(CountA.prototype).join(), Reflect.ownKeys(CountA).join());

// Read as values before any object is made, and called with another receiver.
class Loose { pick() { return this === undefined ? "none" : this.v; } static pick() { return typeof this; } }
const { pick } = Loose.prototype;
say(pick(), pick.call({ v: "lent" }), (0, Loose.pick)(), Loose.pick());

// Never looked at but through an instance in a loop.
class Hot { constructor(n) { this.n = n; } add(k) { return this.n + k; } get twice() { return this.n * 2; } }
let sum = 0;
for (let i = 0; i < 1000; i++) {
    const h = new Hot(i);
    sum += h.add(1) + h.twice;
}
say(sum);

function finish() { console.log(out.join("\n")); }
