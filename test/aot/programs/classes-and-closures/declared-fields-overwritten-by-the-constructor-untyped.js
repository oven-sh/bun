// A declared field is defined as undefined before the constructor's body runs. Where the body always stores again nobody sees that value, and every way to see it still works.
const seed = parseInt(process.argv[2] ?? "3", 10);
const seen = [];
function note(value) { seen.push(value === undefined ? "undefined" : value); }

class Filled {
    count; ratio; on; label; next; parent; list;
    constructor(n) {
        this.list = [n]; this.parent = null; this.next = this; this.label = "n" + n; this.on = n > 1; this.ratio = n + 0.5; this.count = n | 0;
    }
}
const filled = new Filled(seed);
note(Object.keys(filled).join());
note(JSON.stringify({ ...filled, next: 0 }));
note(filled.next.next.count ^ 5);
note(filled.count + filled.ratio);

class FilledOnOnePath { count; constructor(n) { if (n > 100) this.count = n; } }
note(new FilledOnOnePath(seed).count);
note(new FilledOnOnePath(seed + 200).count);
note("count" in new FilledOnOnePath(seed));

class NeverFilled { count; }
note(new NeverFilled().count);
note(Object.keys(new NeverFilled()).join());

class ReadsFirst { count; before; constructor(n) { this.before = this.count; this.count = n; } }
note(new ReadsFirst(seed).before);

class MethodReadsFirst { count; constructor(n) { this.look(); this.count = n; } look() { note(this.count); } }
note(new MethodReadsFirst(seed).count);

let registered;
function lookAtRegistered() { note(registered.count); }
class LeaksFirst { count; constructor(n) { registered = this; lookAtRegistered(); this.count = n; } }
note(new LeaksFirst(seed).count);

class EnumeratesFirst { count; label; constructor(n) { note(JSON.stringify(this)); note(Object.keys(this).join()); this.label = "l"; this.count = n; } }
note(Object.keys(new EnumeratesFirst(seed)).join());

class TestsFirst { count; constructor(n) { note("count" in this); note(Object.hasOwn(this, "count")); this.count = n; } }
note(new TestsFirst(seed).count);

class FilledByMethod { count; constructor(n) { this.reset(n); } reset(n) { this.count = n * 2; } }
note(new FilledByMethod(seed).count);

class Parent { constructor() { this.start(); } start() { } }
class ReadWhileParentRuns extends Parent { count; constructor(n) { super(); this.count = n; } start() { note(this.count); note("count" in this); } }
note(new ReadWhileParentRuns(seed).count);

class StoredWhileParentRuns extends Parent { count; constructor() { super(); } start() { this.count = 7; } }
note(new StoredWhileParentRuns().count);

let lastBuilt;
class Registering { constructor() { lastBuilt = this; } }
function lookAtLastBuilt() { note(lastBuilt.count); }
class ChildOfRegistering extends Registering { count; constructor(n) { super(); lookAtLastBuilt(); this.count = n; } }
note(new ChildOfRegistering(seed).count);

class Shape { sides; kind; constructor() { this.sides = 3; } }
class Square extends Shape { constructor() { super(); this.sides = 4; this.kind = "square"; } }
note(new Shape().kind); note(new Shape().sides); note(new Square().kind); note(new Square().sides); note(Object.keys(new Square()).join());

class InitializedThenOverwritten { label = 0; total = 1; constructor(n) { this.label = "s" + n; this.total = this.total + n; } }
note(new InitializedThenOverwritten(seed).label); note(new InitializedThenOverwritten(seed).total);

class ThrowsBeforeStore {
    count;
    constructor(fail) { try { if (fail) throw new Error("no"); this.count = 1; } catch { note("caught"); } }
}
note(new ThrowsBeforeStore(true).count); note(new ThrowsBeforeStore(false).count);

class Private {
    #count; #label = "a";
    constructor(n) { this.#count = n | 0; }
    get count() { return this.#count; }
    get label() { return this.#label; }
    static has(value) { return #count in value; }
}
note(new Private(seed).count ^ 1); note(new Private(seed).label); note(Private.has(new Private(seed))); note(Private.has({}));

class PrivateReadFirst { #count; before; constructor(n) { this.before = this.#count; this.#count = n; } get count() { return this.#count; } }
note(new PrivateReadFirst(seed).before); note(new PrivateReadFirst(seed).count);

class WithSetterAbove { set count(value) { note("setter " + value); } }
class HidesSetter extends WithSetterAbove { count; constructor(n) { super(); this.count = n; } }
note(Object.getOwnPropertyDescriptor(new HidesSetter(seed), "count").value);

class Frozen { count; constructor(n) { this.count = n; Object.freeze(this); } }
note(new Frozen(seed).count); note(Object.isFrozen(new Frozen(seed)));

class ClosureSeesIt { count; read = () => this.count; before; constructor(n) { this.before = this.read(); this.count = n; } }
note(new ClosureSeesIt(seed).before); note(new ClosureSeesIt(seed).read());

class ReturnsEarly { count; constructor(n) { if (n < 100) return; this.count = n; } }
note(new ReturnsEarly(seed).count);

console.log(seen.join(" | "));
