// `this[kState] = v` in a constructor function: no layout lists the field, Link appends it. A read under the symbol looks at the slot: filled, it is the object's own value; empty, the read goes as it is written. ONE DEED: the constructor stores under Symbol.for() and under Symbol.toStringTag.
// The symbols come out of a literal: declared one by one they would be listed by the front end itself.
const { kState, kAbove, kLate } = { kState: Symbol("state"), kAbove: Symbol("above"), kLate: Symbol("late") };
function Thing(v) { this.plain = v; this[kState] = v; }
Thing.prototype[kAbove] = "above";
const holder = (globalThis.holder = {});
// Nothing is proven of the parameter. `plain` is a name of one layout alone, so that one is expected.
function read(thing) { return [thing.plain, thing[kState], thing[kAbove], thing[kLate]].map(String).join("|"); }
holder.read = read;
holder.Thing = Thing;
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
const show = (thing) => attempt(() => holder.read(thing));
const kShared = Symbol.for("shared");
function Tagged(v) { this.tagged = v; this[kShared] = v; this[Symbol.toStringTag] = "T" + v; }
function readTagged(t) { return [t.tagged, t[kShared], t[Symbol.toStringTag], String(t)].join("|"); }
holder.readTagged = readTagged; holder.Tagged = Tagged;
const one = new holder.Tagged(1), other = new holder.Tagged(2);
delete other[kShared]; delete other[Symbol.toStringTag];
console.log(holder.readTagged(one), holder.readTagged(other));
