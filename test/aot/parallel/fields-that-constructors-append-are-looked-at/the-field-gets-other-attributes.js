// `this[kState] = v` in a constructor function: no layout lists the field, Link appends it. A read under the symbol looks at the slot: filled, it is the object's own value; empty, the read goes as it is written. ONE DEED: the field is made read-only and hidden.
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
const one = new holder.Thing(1);
Object.defineProperty(one, kState, { writable: false, enumerable: false });
console.log(show(one), Reflect.set(one, kState, 5), show(one), Object.getOwnPropertySymbols(one).length, Object.keys(one).join());
