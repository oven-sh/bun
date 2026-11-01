function exportAll(target, all) {
  for (const name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true });
}
const target = {};
exportAll(target, { one: () => 1, two: () => 2 });
const found = Object.getOwnPropertyDescriptor(target, "one");
console.log("called", found.get());
