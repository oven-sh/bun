// Instances to JSON and back, with toJSON and a reviver
class Money {
  constructor(cents) {
    this.cents = cents;
  }
  toJSON() {
    return { money: this.cents };
  }
  plus(other) {
    return new Money(this.cents + other.cents);
  }
}
function trip(list) {
  const text = JSON.stringify({ list: list.map(cents => new Money(cents)), at: undefined, n: list.length });
  const back = JSON.parse(text, (key, value) => (value && value.money !== undefined ? new Money(value.money) : value));
  return text + " " + back.list.reduce((sum, money) => sum.plus(money), new Money(0)).cents + " " + ("at" in back);
}
console.log(trip([1, 2, 3]));
console.log(trip([100]));
console.log(trip([]));
