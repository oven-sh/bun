function exportAll(target, all) {
  for (const name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true });
}
const target = {};
exportAll(target, { one: () => 1, two: () => 2 });
function told(ask) { return ask(); }
const found = Object.getOwnPropertyDescriptor(target, "one");
const part = found.get;
console.log("called", typeof part === "function" ? told(part) : "none");
