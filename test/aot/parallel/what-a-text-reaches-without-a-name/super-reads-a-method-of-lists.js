// STATISTIC: FunctionsLowered <= 400
class Doubled extends Array {
  twice() {
    return super.map(value => value * 2);
  }
  kept() {
    return super["filter"](value => value > 1);
  }
}
const made = Doubled.from([1, 2, 3]);
console.log(made.twice().join(), made.kept().join(), made instanceof Doubled);
