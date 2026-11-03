// Method borrowed keeps its home object: compiled answers as plain.
class A {
  m() {
    return "A";
  }
}
class B extends A {
  m() {
    return "B>" + super.m();
  }
}
const thief = { m: B.prototype.m };
console.log(thief.m(), B.prototype.m.call({}));
