// What nobody hands to the addon: it finds objects, functions and classes of the program by a name on the global object, and changes, calls and constructs them.
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
const shared = new Point(1, 2);
const settings = { depth: 3, inner: { limit: 4 }, points: [new Point(5, 6)] };
let calls = 0;
globalThis.shared = shared;
globalThis.settings = settings;
globalThis.Point = Point;
globalThis.hook = function (n) {
  calls += n;
  return calls;
};
globalThis.level = 1;

function readShared() {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += shared.x + shared.y + shared.sum();
  return sum;
}
function readSettings() {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += settings.depth + settings.inner.limit + settings.points[0].x;
  return sum;
}
function readLevel() {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += level;
  return sum;
}
function readLevelThroughTheObject() {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += globalThis.level;
  return sum;
}
row("untouched", () => [readShared(), readSettings(), readLevel(), readLevelThroughTheObject(), calls]);
row("read", () => [attack.readGlobal("shared") === shared, attack.readGlobal("Point") === Point, attack.readGlobal("level"), typeof attack.readGlobal("absent")]);
row("a field of an instance", () => [attack.storeIntoGlobal("shared", "x", 10), readShared()]);
row("a field of an instance, another kind", () => [attack.storeIntoGlobal("shared", "y", 0.5), readShared()]);
row("a field removed", () => [attack.removeFromGlobal("shared", "y"), String(readShared()), attack.storeIntoGlobal("shared", "y", 2), readShared(), Object.keys(shared).join()]);
row("a method hidden", () => [attack.storeIntoGlobal("shared", "sum", () => 100), readShared(), attack.removeFromGlobal("shared", "sum"), readShared()]);
row("a field of a literal", () => [attack.storeIntoGlobal("settings", "depth", 30), readSettings()]);
row("what a literal reaches", () => [attack.storeInto(attack.readGlobal("settings"), "inner", "limit", 40), attack.storeInto(attack.readGlobal("settings").points, 0, "x", 50), readSettings()]);
row("what a literal reaches, replaced", () => [attack.storeIntoGlobal("settings", "inner", { limit: 400 }), attack.storeIntoGlobal("settings", "points", [{ x: 500 }]), readSettings()]);
row("a function called", () => [attack.callGlobal("hook", 3), attack.callGlobal("hook", 4), calls]);
row("a function called inside a loop", () => { let sum = 0; for (let round = 0; round < 50; round++) { sum += calls; attack.callGlobal("hook", 1); sum += calls; } return sum; });
row("a class constructed", () => { const p = attack.constructGlobal("Point", 7, 8); return [p instanceof Point, p.sum(), JSON.stringify(p)]; });
row("the prototype of a class", () => [attack.storeInto(attack.readGlobal("Point"), "prototype", "sum", function () { return -1; }), readShared(), new Point(1, 1).sum()]);
row("a global variable", () => [attack.storeGlobal("level", 2), readLevel(), readLevelThroughTheObject()]);
row("a global variable, another kind", () => [attack.storeGlobal("level", "s"), readLevel().length, typeof level]);
row("a global variable inside a loop", () => { attack.storeGlobal("level", 0); let sum = 0; for (let round = 0; round < 50; round++) { sum += level; attack.storeGlobal("level", round); sum += level + globalThis.level; } return sum; });
row("a new global variable", () => [attack.storeGlobal("late", 5), typeof late, globalThis.late]);
row("a global replaced by another object", () => [attack.storeGlobal("shared", new Point(100, 200)), readShared(), globalThis.shared.sum === shared.sum, globalThis.shared.x]);
row("a global function replaced", () => [attack.storeGlobal("hook", () => "other"), hook(1), attack.callGlobal("hook", 1), calls]);
row("a built-in function read and called", () => [attack.callGlobal("parseInt", "42px"), attack.call(undefined, attack.read(attack.readGlobal("Math"), "max"), 3, 9), attack.constructGlobal("Array", 3).length, attack.constructGlobal("Map") instanceof Map]);
row("Object.keys called on an instance", () => attack.call(undefined, attack.read(attack.readGlobal("Object"), "keys"), new Point(1, 2)));
row("Object.assign called on an instance", () => { const p = new Point(1, 2); attack.call(undefined, attack.read(attack.readGlobal("Object"), "assign"), p, { x: 9, z: 1 }); return [p.sum(), JSON.stringify(p)]; });
row("Reflect.defineProperty called on an instance", () => { const p = new Point(1, 2); const define = attack.read(attack.readGlobal("Reflect"), "defineProperty"); return [attack.call(undefined, (o, d) => define(o, "x", d), p, { get: () => 70 }), p.sum()]; });

row("a walk of several names", () => [attack.storeAtGlobalPath(["settings", "inner"], "limit", 4000), attack.storeAtGlobalPath(["settings", "points", 0], "x", 5000), readSettings()]);
row("a walk through a class to its prototype", () => [attack.storeAtGlobalPath(["Point", "prototype"], "sum", function () { return -2; }), new Point(1, 1).sum()]);
row("a walk through an instance to its class", () => [attack.storeAtGlobalPath(["shared", "constructor", "prototype"], "sum", function () { return -3; }), new Point(1, 1).sum()]);
let heard = 0;
process.on("attack", n => (heard += n));
row("a listener found on process", () => { let sum = 0; for (let round = 0; round < 50; round++) { sum += heard; attack.callMethodAtGlobalPath(["process"], "emit", "attack", round); sum += heard; } return [sum, heard]; });
row("a listener taken from process and called", () => [attack.callMethodAtGlobalPath(["process"], "listeners", "attack").length, attack.call(undefined, attack.callMethodAtGlobalPath(["process"], "listeners", "attack")[0], 1000), heard]);

// An object that no global reaches and that is never handed over stays what the compiler knows it to be.
const own = new Point(1000, 2000);
function readOwn() {
  let sum = 0;
  for (let round = 0; round < 200; round++) { sum += own.x; attack.storeIntoGlobal("settings", "depth", round); sum += own.y; }
  return sum;
}
row("an object of the program's own", () => readOwn());

// These take the globals away, so they come last.
row("a global variable made a getter", () => [attack.defineGetter(globalThis, "level"), level, readLevel(), readLevelThroughTheObject()]);
row("a global variable removed", () => [attack.removeKey(globalThis, "level"), typeof level, "level" in globalThis]);
row("a global variable removed, then read", () => readLevel());
row("a global variable comes back", () => [attack.storeGlobal("level", 3), readLevel()]);
