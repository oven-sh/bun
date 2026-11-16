// A method passes a call of five arguments on to a class that it gets: to two classes that have the method, to an object, a proxy, an heir and to what has no such method.
const K = 3000;
class Slot { constructor(n) { this.n = n; }
  static visit(arg, role, type, width, func) { if (!arg.isSlot) return; return func(arg.slot, role, type, width); } }
class Temp { constructor(n) { this.n = n; }
  static visit(arg, role, type, width, func) { if (arg.isSlot) return; return func(arg, role, type, width); } }
class Arg { constructor(slot, n) { this._slot = slot; this.n = n; }
  get isSlot() { return this._slot !== null; } get slot() { return this._slot; }
  visit(thing, role, type, width, func) { return thing.visit(this, role, type, width, func); } }
const things = globalThis.things = { Slot, Temp, own: { visit(arg, role, type, width, func) { return arguments.length + width; } }, short: { visit(arg, role) { return role + arguments.length; } } };
globalThis.args = []; for (let k = 0; k < 8; k++) args.push(new Arg(k % 3 ? null : new Slot(k), k));
const list = globalThis.args, all = globalThis.things;
let t = 0;
function count(value, role, type, width) { return value.n + role + type + width; }
const held = JSON.parse('{"a":["Slot","Temp","Slot","Slot"]}').a;
for (let k = 0; k < K; k++) { const r = list[k & 7].visit(all[held[k & 3]], k & 1, 2, 3, count); t = t + (r === undefined ? 1 : r) | 0; }
console.log(t, list[1].visit(all.own, 1, 2, 3, count), list[1].visit(all.short, 1, 2, 3, count));
try { list[0].visit({}, 1, 2, 3, count); } catch (e) { console.log(e.constructor.name); }
try { list[0].visit(null, 1, 2, 3, count); } catch (e) { console.log(e.constructor.name); }
all.Slot.visit = (a, b, c, d, e) => a.n + b + c + d; console.log(list[0].visit(all.Slot, 1, 2, 3, count)); delete all.Slot.visit;
try { list[0].visit(all.Slot, 1, 2, 3, count); } catch (e) { console.log(e.constructor.name); }
class Below extends Temp { static visit(...rest) { return rest.length + (super.visit(...rest) ?? 0); } } console.log(list[1].visit(Below, 1, 2, 3, count));
console.log(list[1].visit(new Proxy(Temp, { get(target, name) { return name === "visit" ? (a, b, c, d, e) => String([b, c, d]) : target[name]; } }), 1, 2, 3, count));
