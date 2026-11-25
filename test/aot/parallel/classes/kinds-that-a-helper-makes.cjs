// COUNTER: InstanceTemplatesCached >= 1
// A helper makes the kinds below a parent: their constructors are no classes of the program. Their objects are laid out as the parent's are, and what their prototypes hide of it is asked of each object.
"use strict";
function kindOf(above, members, setUp) {
  function Kind(volume, label) { const each = Reflect.construct(above, [volume, label], new.target || Kind); if (setUp) setUp(each, volume); return each; }
  const under = Object.setPrototypeOf({}, above.prototype);
  for (const name of Object.keys(members)) Object.defineProperty(under, name, { value: members[name], writable: true, enumerable: true, configurable: true });
  Kind.prototype = under;
  Kind.madeFrom = above.prototype;
  Kind.unit = above.unit;
  return Kind;
}
function Vessel(volume, label) { this.volume = volume; this.label = label; this.filled = 0; this.lid = null; if (this.begin) this.begin(); }
Vessel.unit = "l";
Vessel.prototype.pour = function (n) { const room = this.volume - this.filled, taken = n < room ? n : room; this.filled += taken; return taken; };
Vessel.prototype.left = function () { return this.volume - this.filled; };
const Jug = kindOf(Vessel, { begin() { this.lid = "cork"; }, pours: 3 });
const Barrel = kindOf(Jug, { left() { return Jug.prototype.left.call(this) * 10; } });
const Sealed = kindOf(Vessel, { pour() { return 0; } }, (each, volume) => { each.seal = volume > 3; });
const Hidden = kindOf(Vessel, { label: "of the prototype", volume: 99 });
const Plain = kindOf(Vessel, {});
function rounds(kinds, count) {
  let poured = 0, left = 0;
  for (let i = 0; i < count; i++) {
    const each = new kinds[i % kinds.length](i % 13, "v" + (i % 3));
    poured += each.pour(5); left += each.left();
    if (each.lid) left++;
    if (each.seal) left += 2;
  }
  return poured + " " + left;
}
for (const kinds of [[Vessel], [Jug], [Vessel, Jug], [Jug, Barrel, Sealed], [Hidden, Plain, Barrel, Jug, Sealed, Vessel]]) console.log(rounds(kinds, 200));
console.log(new Hidden(4, "own").label, Hidden.prototype.label, delete Hidden.prototype.label, new Hidden(1).label, new Barrel(7, "b").lid, Barrel.unit, Barrel.madeFrom === Jug.prototype, Object.keys(new Jug(1, "x")).join());
// What hides a field: a getter, a setter that is called, one that is read-only, taken away again.
let stored = []; Object.defineProperty(Plain.prototype, "filled", { configurable: true, get() { return 2; }, set(v) { stored.push(v); } });
console.log(rounds([Plain], 20), stored.length, Object.keys(new Plain(3, "p")).join());
delete Plain.prototype.filled; console.log(rounds([Plain], 20), Object.keys(new Plain(3, "p")).join());
Object.defineProperty(Jug.prototype, "volume", { value: 1, writable: false, configurable: true });
try { new Jug(4, "stopped"); console.log("made"); } catch (error) { console.log(error.constructor.name); } try { new Barrel(4, "below"); console.log("made"); } catch (error) { console.log(error.constructor.name); }
delete Jug.prototype.volume; console.log(rounds([Jug, Barrel], 30));
Vessel.prototype.begin = function () { this.label += "!"; }; console.log(new Plain(1, "a").label, new Jug(1, "a").label, rounds([Plain, Jug, Vessel], 60));
Plain.prototype = { left: () => -1, pour: () => 1, __proto__: Vessel.prototype }; console.log(rounds([Plain], 20), new Plain(1, "n") instanceof Vessel);
for (let i = 0; i < 3; i++) { const Late = kindOf(Barrel, { pour(n) { return n + i; } }); console.log(rounds([Late, Barrel], 24), new Late(2, "l").left()); }
