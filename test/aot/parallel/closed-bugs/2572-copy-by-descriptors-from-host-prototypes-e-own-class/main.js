class Base { get value() { return 1; } set value(v) {} }
function f() {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Base.prototype));
  const d = Object.getOwnPropertyDescriptor(copy, "value");
  return { get: d.get, set: d.set };
}
console.log(typeof f().get, typeof f().set, f().get.call({}));
