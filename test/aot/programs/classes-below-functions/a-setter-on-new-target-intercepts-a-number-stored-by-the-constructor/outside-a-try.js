function print(text) { console.log(text); }
function str(v) {
  return v;
}
function A() {
  this.v = 1;
}

class B extends A {
  set v(x) {}
}
  const o = Reflect.construct.call(null, A, [], B);
  print("o $.v: " + str(o.v));
