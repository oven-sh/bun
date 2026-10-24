// `v;` defines the field with undefined on the objects of the class below too, where a method that nobody calls stores integers under the name. Nobody looks at the objects: that is the point.
class Base {
  v;
  constructor(v) {
    this.v = v;
  }
  step(n) {
  }
}
class Derived extends Base {
  step(n) {
    this.v = this.v * 79 + this.w | 0;
  }
}
const many = [new Derived(1), new Derived(2)];
console.log("made", many.length);
