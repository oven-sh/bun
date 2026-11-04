class Base {
  constructor() { this.made = new.target.describe(); }
}
class Derived extends Base {
  static describe() { return "derived"; }
}
console.log(new Derived().made, Reflect.construct(Base, [], Derived).made);
