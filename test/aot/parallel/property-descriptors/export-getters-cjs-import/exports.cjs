function exportAll(target, all) {
  for (const name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true });
}
exportAll(module.exports, { one: () => () => 1, two: () => 2 });
