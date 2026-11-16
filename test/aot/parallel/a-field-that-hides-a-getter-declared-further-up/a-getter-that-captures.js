// The getter that the field hides holds a variable of the function around it.
class Box { constructor(v) { this.v = v; } }
function make(k) {
  class Base { [Symbol.toStringTag] = JSON.parse("7"); }
  class Loud extends Base { get [Symbol.toStringTag]() { return new Box(k); } }
  class A extends Base {} class B extends Base {} class C extends Base {}
  const read = x => x[Symbol.toStringTag].v;
  return String(read(new Loud())) + [new A(), new B(), new C()].length;
}
console.log(make(1), make(2));
