// What a CommonJS program exports is found from the global object without a hand-over, through process.mainModule, in a program that names process.mainModule itself.
const loaded = { exports: {} };
process.dlopen(loaded, process.env.ADDON);
const attack = loaded.exports;
let at = 0;
function row(label, f) {
  let said;
  try {
    said = JSON.stringify(f());
  } catch (error) {
    said = "threw " + error.constructor.name;
  }
  console.log(String(++at).padStart(3) + " " + label + ": " + said);
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
const path = ["process", "mainModule", "exports"];
row("the program names it", () => process.mainModule === module);
row("untouched", () => [read(), attack.typeAtGlobalPath(["process", "mainModule"]), attack.typeAtGlobalPath(path)]);
row("an exported object", () => [attack.storeAtGlobalPath([...path, "state"], "x", 10), read()]);
row("an export", () => [attack.storeAtGlobalPath(path, "limit", 50), read(), module.exports.limit]);
row("an exported function", () => [attack.callMethodAtGlobalPath(path, "bump", 3), calls]);
row("an exported function inside a loop", () => { let sum = 0; for (let round = 0; round < 50; round++) { sum += calls; attack.callMethodAtGlobalPath(path, "bump", 1); sum += calls; } return sum; });
row("an exported class", () => [attack.storeAtGlobalPath([...path, "Point", "prototype"], "sum", function () { return -1; }), read()]);
row("the exports object is replaced", () => [attack.storeAtGlobalPath(["process", "mainModule"], "exports", { limit: 7 }), module.exports.limit, exports.limit, read()]);
