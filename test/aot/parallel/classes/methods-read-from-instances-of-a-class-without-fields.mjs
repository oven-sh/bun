// One crate has a property of its own under the name of a method. The class has no fields, and its method changes a variable of the function that declares it.
const lib = (function () {
  let total = 0;
  class Crate {
    lift(by) { total += by; return total; }
  }
  return { Crate };
})();
const { Crate } = lib;
const swapped = new Crate(), plain = new Crate(), other = new Crate();
swapped.lift = 5;
function isOfClass(crate) { return crate.lift === Crate.prototype.lift; }
const places = new Map([[Crate.prototype.lift, "of the class"]]);
const known = [Crate.prototype.lift];
function isKnown(crate) { return known.indexOf(crate.lift) >= 0; }
for (const crate of [plain, other, swapped, plain]) console.log(isOfClass(crate), places.get(crate.lift), isKnown(crate));
console.log(plain.lift === other.lift, plain.lift === Crate.prototype.lift, typeof swapped.lift);
