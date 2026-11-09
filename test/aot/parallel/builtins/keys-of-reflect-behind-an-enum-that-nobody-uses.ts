// The initializers of an enum run whether anybody uses the enum or not. A member of a built-in object that one of them reads is listed from then on.
enum Unused {
  A = typeof Reflect.has === "function" ? 1 : 2,
  B = 3,
  C = typeof Reflect.get === "function" ? 4 : 5,
}
function inside() {
  enum Inner {
    A = typeof Reflect.set === "function" ? 1 : 2,
  }
}
inside();
Object.entries(Reflect);
console.log(Reflect.ownKeys(Reflect).map(String).join());
