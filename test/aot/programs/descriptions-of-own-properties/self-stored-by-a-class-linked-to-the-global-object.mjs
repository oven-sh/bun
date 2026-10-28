// The prototype object of a class is linked to the global object, and the constructor stores `self`.
class Below {
  constructor() {
    this.self = "stored by a class";
  }
}
Object.setPrototypeOf(Below.prototype, globalThis);
const made = new Below();
console.log(Object.hasOwn(made, "self"), self, made.self);
