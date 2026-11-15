// The keys of an accessor and of a static method are computed where the class stands, though nobody makes or names the class.
// STATISTIC: FunctionsLowered >= 300
const name = ["from", "Entries"].join(""), said = [];
function never(from, key) { return from[key]; }
class Shelf {
  get [(said.push(Object[name]([["a", 1]]).a), "first")]() { return 1; }
  static [(said.push(Object[name]([["b", 2]]).b), "second")](from, key) { return from[key]; }
}
console.log("KEYS", said.join(" "));
