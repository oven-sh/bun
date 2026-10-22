// The one store that the compiler sees is not the only one: text that is evaluated in the scope of the module stores another class.
var Swapped;
function initSwapped() {
  Swapped = class Swapped {
    v = 1;
  };
}
initSwapped();
try {
  eval("Swapped = class Other { w = 2 }");
} catch (error) {
  console.log(error.constructor.name);
}
class BelowSwapped extends Swapped {
  z = 3;
}
const made = new BelowSwapped();
console.log(made.v, made.w, made.z, Object.getPrototypeOf(BelowSwapped).name, Object.keys(made).join());
