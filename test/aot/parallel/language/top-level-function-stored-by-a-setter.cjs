function f() {
  const o = {
    get f() {
      return f;
    },
    set f(v) {
      f = v;
    },
    a: arguments,
  };
  return o;
}
const o = f();
console.log(o.f === f, o.a.callee === f, o.a.length);
const first = f;
o.f = 7;
console.log(f, first().a.callee === first);
