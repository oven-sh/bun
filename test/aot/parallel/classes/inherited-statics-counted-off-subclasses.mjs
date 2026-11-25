// A subclass counts in a static field that its base class declares: the first store gives the subclass a property of its own, so no guard on the inherited field stands in front of the read.
// STATISTIC: InheritedStaticsReadAtSites >= 3
const said = [];
const Counted = Parent => class extends Parent { static count = 0; constructor(...all) { super(...all); this.order = ++new.target.count; } };
class Item { constructor(id) { this.id = id; } }
class Both extends Counted(Item) {}
class Deep extends Both {}
class Other extends Counted(Both) {}
class Plain { static made = 0; static text = "t"; static next() { return ++this.made; } static add(x) { this.made += x; return this.made; } static say() { this.text += "!"; return this.text; } constructor() { this.order = this.constructor.made++; } }
class Heir extends Plain {}
class Own extends Plain { static made = 100; }
let sum = 0;
for (let k = 0; k < 300; k++) {
  sum = (sum * 3 + new Both(k & 63).order) | 0;
  sum = (sum * 3 + new Deep(k).order) | 0;
  if (k % 3) sum = (sum + new Other(k).order) | 0;
}
said.push(sum, Both.count, Deep.count, Other.count, Object.hasOwn(Both, "count"), Object.hasOwn(Deep, "count"));
for (let k = 0; k < 200; k++) { sum = (sum + Heir.next() + Own.next()) | 0; sum = (sum * 5 + new Heir().order + new Own().order) | 0; if (k % 50 === 49) said.push(Heir.say(), Heir.add(0.5), Own.add(2)); }
said.push(sum, Plain.made, Heir.made, Own.made, Plain.text, Heir.text);
// The subclass loses its own property again, and the base class is written to.
for (let k = 0; k < 60; k++) { if (k === 20) delete Heir.made; if (k === 40) Plain.made = 1000; sum = (sum + Heir.next()) | 0; }
said.push(sum, Plain.made, Heir.made);
// Frozen, an accessor above, and another prototype.
class Fixed extends Plain {}
Object.freeze(Fixed);
for (let k = 0; k < 5; k++) { try { said.push(Fixed.next()); } catch (error) { said.push(error.name); } }
class Told { static #n = 0; static get made() { return Told.#n; } static set made(v) { Told.#n = v * 2; } static next() { return ++this.made; } }
class Below extends Told {}
for (let k = 0; k < 6; k++) said.push(Below.next());
class Moved extends Plain {}
for (let k = 0; k < 6; k++) { if (k === 3) Object.setPrototypeOf(Moved, { made: 500, next() { return ++this.made; } }); said.push(Moved.next()); }
said.push(Reflect.construct(Both, [1], Deep).order, Deep.count, Both.count, Both.name, Other.name);
console.log(said.join(" "));
