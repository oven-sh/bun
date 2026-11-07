// Only argument is a class chosen by index: compiled answers as plain.
class P {
  k() {
    return 1;
  }
}
class Q {
  k() {
    return 2;
  }
}
const pick = [P, Q][Date.now() > 0 ? 1 : 0];
const wrap = c =>
  class extends c {
    k() {
      return super.k() * 10;
    }
  };
console.log(new (wrap(pick))().k(), new (wrap(wrap(pick)))().k());
