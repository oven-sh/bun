// The method of a class that is made reads under a key; the function beside it never runs.
// STATISTIC: FunctionsLowered >= 300
function pickNever(from, key) {
  return from[key];
}
class Shelf {
  constructor(items) {
    this.items = items;
  }
  ask(key) {
    return this.items[key];
  }
}
console.log(String(new Shelf([1, [2]]).ask(["fl", "at"].join("")).call([1, [2]])));
