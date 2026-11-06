// In a program that never names process.mainModule, an executable made by bun compile has none, so an addon does not find what the program exports by a walk from the global object.
// Each line begins with HIDDEN and says what the addon said, what the program reads afterwards, and what it read before: as plain Bun, or the walk fails and nothing has changed.
const loaded = { exports: {} };
process.dlopen(loaded, process.env.ADDON);
const attack = loaded.exports;
let at = 0;
function row(label, f) {
  const before = JSON.stringify(look());
  let said;
  try {
    said = f();
  } catch (error) {
    said = "threw " + error.constructor.name + " in the program";
  }
  if (typeof said === "string" && said.startsWith("threw ")) said = said.replace(/:.*/, "");
  console.log(String(++at).padStart(3) + " HIDDEN " + label + ": " + JSON.stringify(said) + " | after: " + JSON.stringify(look()) + " | before: " + before);
}
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
const state = new Point(1, 2);
let calls = 0;
exports.state = state;
exports.limit = 5;
exports.bump = n => (calls += n);
exports.Point = Point;
function read() {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += state.x + state.y + state.sum() + exports.limit;
  return sum;
}
function look() {
  return [read(), calls, exports.limit, module.exports === exports];
}
const path = ["process", "main" + "Module".slice(0, process.argv.length * 6), "exports"];
row("an exported object", () => attack.storeAtGlobalPath([...path, "state"], "x", 10));
row("an export", () => attack.storeAtGlobalPath(path, "limit", 50));
row("an exported function", () => attack.callMethodAtGlobalPath(path, "bump", 3));
row("an exported class", () => attack.storeAtGlobalPath([...path, "Point", "prototype"], "sum", function () { return -1; }));
row("the exports object is replaced", () => attack.storeAtGlobalPath(path.slice(0, 2), "exports", { limit: 7 }));
