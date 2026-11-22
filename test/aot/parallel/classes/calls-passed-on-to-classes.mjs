// A method passes a call of five arguments on to a class that it gets: to two classes that have the method, to an object, a proxy, an heir and to what has no such method.
const K = 3000;
class Pier { constructor(n) { this.n = n; }
  static lade(boat, deed, crane, load, tide) { return boat.isMoored ? deed(boat.pier, crane, load, tide) : undefined; } }
class Open { constructor(n) { this.n = n; }
  static lade(boat, deed, crane, load, tide) { if (!boat.isMoored) return deed(boat, crane, load, tide); } }
class Boat { constructor(n, pier) { this.n = n; this.rope = pier; }
  get pier() { return this.rope; } get isMoored() { return this.rope !== null; }
  lade(place, deed, crane, load, tide) { return place.lade(this, deed, crane, load, tide); } }
const things = globalThis.things = { Pier, Open, own: { lade(boat, deed, crane, load, tide) { return arguments.length + tide; } }, short: { lade(boat, deed, crane) { return crane + arguments.length; } } };
globalThis.args = []; for (let k = 0; k < 8; k++) args.push(new Boat(k, k % 3 ? null : new Pier(k)));
const list = globalThis.args, all = globalThis.things;
let t = 0;
function count(value, crane, load, tide) { return value.n + crane + load + tide; }
const held = JSON.parse('{"a":["Pier","Open","Pier","Pier"]}').a;
for (let k = 0; k < K; k++) { const r = list[k & 7].lade(all[held[k & 3]], count, k & 1, 2, 3); t = t + (r === undefined ? 1 : r) | 0; }
console.log(t, list[1].lade(all.own, count, 1, 2, 3), list[1].lade(all.short, count, 1, 2, 3));
try { list[0].lade({}, count, 1, 2, 3); } catch (e) { console.log(e.constructor.name); }
try { list[0].lade(null, count, 1, 2, 3); } catch (e) { console.log(e.constructor.name); }
all.Pier.lade = (a, deed, b, c, d) => a.n + b + c + d; console.log(list[0].lade(all.Pier, count, 1, 2, 3)); delete all.Pier.lade;
try { list[0].lade(all.Pier, count, 1, 2, 3); } catch (e) { console.log(e.constructor.name); }
class Below extends Open { static lade(...rest) { return rest.length + (super.lade(...rest) ?? 0); } } console.log(list[1].lade(Below, count, 1, 2, 3));
console.log(list[1].lade(new Proxy(Open, { get(target, name) { return name === "lade" ? (a, deed, b, c, d) => String([b, c, d]) : target[name]; } }), count, 1, 2, 3));
