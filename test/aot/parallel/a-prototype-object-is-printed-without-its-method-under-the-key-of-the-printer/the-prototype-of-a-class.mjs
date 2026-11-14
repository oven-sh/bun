// The printer calls the method under its key for an instance of a class and not for the prototype object of the class: the method reads a private field, which only an instance has.
let calls = 0;
class Money {
  #cents = 150;
  [Symbol.for("nodejs.util.inspect.custom")]() {
    calls++;
    return "Money<" + this.#cents + ">";
  }
}
console.log(Money.prototype);
console.log(calls);
console.log(new Money());
console.log(calls);
console.log(Object.getPrototypeOf(new Money()));
console.log(calls);
