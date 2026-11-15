// A field's initializer alone calls the private method, and the method reads under a key made at run time.
// STATISTIC: FunctionsLowered >= 300
const name = ["from", "Entries"].join("");
function never(from, key) { return from[key]; }
class Shelf { #pick(from, key) { return from[key]; } made = this.#pick(Object, name)([["a", 1]]).a; }
console.log("FIELD", new Shelf().made);
