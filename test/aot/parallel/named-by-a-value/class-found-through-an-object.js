class Base {
  static make() { return "made by " + this.name; }
  hello() { return "hello"; }
}
class Derived extends Base {}
const object = new Derived();
const found = Object.getPrototypeOf(object.constructor);
console.log(found.make(), new found().hello(), Object.getPrototypeOf(Derived.prototype).hello());
