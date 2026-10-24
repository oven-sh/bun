// A `this.name = v` adds an optional member only where `this` is an instance of the class and no member declares the name.
const key = "k";
class T {
  declared = 0;
  constructor() {
    this.a = 1;
    this.declared = 2;
    this[key] = 3;
    this.n += 1;
  }
  m() {
    this.b = 1;
    const f = () => { this.c = 1; };
    function g() { this.d = 1; }
  }
  e = (this.f = 1);
  static s() { this.h = 1; }
}
