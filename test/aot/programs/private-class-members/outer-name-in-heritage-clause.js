// A private name in the heritage clause of a class is the enclosing class's, even if the class declares the same name.
class Outer {
  #name = "outer";
  static read(object) {
    let seen;
    class Inner extends ((seen = object.#name), Object) {
      #name = "inner";
      static read(other) { return other.#name; }
    }
    return seen + " " + Inner.read(new Inner());
  }
  static has(object) {
    let seen;
    class Inner extends ((seen = #name in object), Object) {
      #name = "inner";
      static has(other) { return #name in other; }
    }
    return seen + " " + Inner.has(object);
  }
}
console.log(Outer.read(new Outer()));
console.log(Outer.has(new Outer()));
