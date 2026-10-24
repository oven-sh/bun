// What a literal, a constructor function and a class of untyped code make is expected to begin with the keys it was made with, in their order. The compiler writes the keys of each maker down: what a base constructor stores comes first, a store in an arm of an `if` counts, a store under a computed key ends the list.
function look(o) { return o; }
const hidden = [look];
function ofALiteral(x, y) { const o = { x, y }; hidden[0](o); return o.x + o.y; }
function Emitter() { if (this.listeners === undefined) { this.listeners = null; this.count = 0; } }
function Thing(raw, id) { this.raw = raw; this.sent = false; this.id = id; }
function Heir(raw, id, more) { Emitter.call(this); Thing.call(this, raw, id); this.more = more; }
function Sometimes(first, early) { if (!(this instanceof Sometimes)) return new Sometimes(first, early); this.first = first; if (early) this.early = early; this.last = 1; }
class Base { field = 1; constructor(given) { this.given = given; } }
class Derived extends Base { constructor(given) { super(given); this.own = 2; } }
function Keyed(key) { this.ahead = 1; this[key] = 2; this.behind = 3; }
function method() { this.touched = true; return this; }
function use(o) { hidden[0](o); return Object.keys(o).join(); }
const thing = new Thing(1, 2), heir = new Heir(1, 2, 3), sometimes = new Sometimes(1, 0), derived = new Derived(4), keyed = new Keyed("k");
console.log(ofALiteral(1, 2), use(thing), thing.id, use(heir), heir.more, use(sometimes), sometimes.last, use(Sometimes(1, 2)), use(derived), derived.own, use(keyed), keyed.ahead, use(method.call({})));
