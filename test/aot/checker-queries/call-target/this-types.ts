// Only a `this` parameter writes `this`. In an instance method the checker says the class, in a static method and in a plain function `any`.
function f(this: Date) {}
class C {
  m() {}
  static s() {}
}
function g() {}
