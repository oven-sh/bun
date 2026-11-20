// One crate has a property of its own under the name of a method. A member under a registered symbol stands above the method.
const tag = Symbol.for("crate.tag");
class Crate {
  constructor() { this.kilos = 1; }
  [tag]() { return 1; }
  lift(by) { return this.kilos + by; }
}

const swapped = new Crate(), plain = new Crate(), other = new Crate();
swapped.lift = 5;
function isOfClass(crate) { return crate.lift === Crate.prototype.lift; }
const places = new Map([[Crate.prototype.lift, "of the class"]]);
const known = [Crate.prototype.lift];
function isKnown(crate) { return known.indexOf(crate.lift) >= 0; }
for (const crate of [plain, other, swapped, plain]) console.log(isOfClass(crate), places.get(crate.lift), isKnown(crate));
console.log(plain.lift === other.lift, plain.lift === Crate.prototype.lift, typeof swapped.lift);
