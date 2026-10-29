// Custom inspect method of a class calls inspect.
class Money {
  constructor(amount) { this.amount = amount; }
  [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) { return "Money<" + inspect({ amount: this.amount }, options) + ">"; }
}
console.log(new Money(5));
console.log([new Money(6)], { deep: { deeper: new Money(7) } });
