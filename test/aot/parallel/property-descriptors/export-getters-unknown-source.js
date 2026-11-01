function exportAll(target, all) {
  for (const name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true });
}
const target = {};
exportAll(target, { one: () => 1, two: () => 2 });
const late = {};
exportAll(late, JSON.parse(process.argv.length > 99 ? "{}" : "{ }"));
const below = Object.create(target);
console.log("called", below.one, Object.getOwnPropertyDescriptor(target, "two").get(), Object.keys(late).join());
