// A key known only at run time sets a flag and adds no member; a string literal key is a static name. A field under a symbol that a constant holds is a member.
const k = Symbol();
class A {
  [k] = 1;
  static [k]() {}
  ["a"] = 2;
}
class B {
  ["a"] = 1;
}
class C {
  [k]() {}
}
