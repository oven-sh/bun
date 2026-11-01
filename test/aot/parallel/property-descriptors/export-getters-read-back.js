// A helper defines getters in a for-in loop from the functions of an object, as bundlers write it. Each getter is then taken back out of its descriptor and called.
function exportAll(target, all) {
  for (const name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true });
}
function read(target, key) {
  const found = Object.getOwnPropertyDescriptor(target, key);
  return typeof found.get + " " + found.get();
}
const target = {};
exportAll(target, { one: () => 1, two: () => 2 });
console.log(read(target, "one"), read(target, "two"), target.one, target.two);
