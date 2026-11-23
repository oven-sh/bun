function exportAll(target, all) {
  for (const name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true });
}
const target = {};
exportAll(target, [() => 1, () => 2]);
console.log("called", target[0], target[1], Object.getOwnPropertyDescriptor(target, 0).get(), Object.getOwnPropertyDescriptor(target, "1").get());
