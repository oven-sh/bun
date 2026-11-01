function f() {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Map.prototype));
  const d = Object.getOwnPropertyDescriptor(copy, "size");
  return { get: d.get, set: d.set };
}
console.log(typeof f().get, typeof f().set, f().get.call(new Map([[1, 2]])));
