// Functions of the engine and of the host are called as values that nobody can see through, with none to five arguments, with and without a receiver, the first time and again:
// some of them have a short way for boxed arguments, most have none, and what was found out at the first call is used at the later ones.
const opaque = value => Reflect.get({ value }, ["val", "ue"].join(""));
const map = new Map([["a", 1], [2, "two"]]);
const set = new Set(["a", 2]);
const weakKey = {};
const weakMap = new WeakMap([[weakKey, "weak"]]);
const weakSet = new WeakSet([weakKey]);
const candidates = opaque({
  "Math.abs": [Math.abs, undefined],
  "Math.floor": [Math.floor, undefined],
  "Math.max": [Math.max, undefined],
  "Number.isInteger": [Number.isInteger, undefined],
  "Array.isArray": [Array.isArray, undefined],
  "Object.keys": [Object.keys, undefined],
  "JSON.stringify": [JSON.stringify, undefined],
  parseInt: [parseInt, undefined],
  String: [String, undefined],
  "String.prototype.startsWith": [String.prototype.startsWith, "alphabet"],
  "String.prototype.indexOf": [String.prototype.indexOf, "alphabet"],
  "String.prototype.slice": [String.prototype.slice, "alphabet"],
  "Array.prototype.slice": [Array.prototype.slice, [1, 2, 3, 4]],
  "Array.prototype.includes": [Array.prototype.includes, [1, "a", 3]],
  "Map.prototype.get": [Map.prototype.get, map],
  "Map.prototype.has": [Map.prototype.has, map],
  "Map.prototype.set": [Map.prototype.set, map],
  "Map.prototype.delete": [Map.prototype.delete, map],
  "Set.prototype.has": [Set.prototype.has, set],
  "Set.prototype.add": [Set.prototype.add, set],
  "Set.prototype.delete": [Set.prototype.delete, set],
  "WeakMap.prototype.has": [WeakMap.prototype.has, weakMap],
  "WeakMap.prototype.set": [WeakMap.prototype.set, weakMap],
  "WeakSet.prototype.has": [WeakSet.prototype.has, weakSet],
  "Function.prototype.bind": [Function.prototype.bind, function named(a, b) { return [this, a, b]; }],
  "Object.prototype.hasOwnProperty": [Object.prototype.hasOwnProperty, { a: 1 }],
  "Object.prototype.toString": [Object.prototype.toString, []],
  "process.cwd": [process.cwd, process],
  "Buffer.isBuffer": [Buffer.isBuffer, Buffer],
  "a bound host function": [Math.max.bind(null, 3), undefined],
});
const argumentLists = opaque([[], ["a"], ["a", 1], [2, 1, 0], [weakKey, "w", 1, 2], [1.5, -2, "3", null, undefined]]);
function show(value) {
  if (typeof value === "function") return "function " + value.name + "/" + value.length;
  if (value === map) return "the map of " + map.size;
  if (value === set) return "the set of " + set.size;
  if (value === weakMap) return "the weak map";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return typeof value + " " + String(value);
}
function callPlain(f, a) {
  switch (a.length) {
    case 0: return f();
    case 1: return f(a[0]);
    case 2: return f(a[0], a[1]);
    case 3: return f(a[0], a[1], a[2]);
    case 4: return f(a[0], a[1], a[2], a[3]);
    default: return f(a[0], a[1], a[2], a[3], a[4]);
  }
}
function callAsMethod(holder, a) {
  switch (a.length) {
    case 0: return holder.method();
    case 1: return holder.method(a[0]);
    case 2: return holder.method(a[0], a[1]);
    case 3: return holder.method(a[0], a[1], a[2]);
    case 4: return holder.method(a[0], a[1], a[2], a[3]);
    default: return holder.method(a[0], a[1], a[2], a[3], a[4]);
  }
}
function callWithReceiver(f, receiver, a) {
  switch (a.length) {
    case 0: return f.call(receiver);
    case 1: return f.call(receiver, a[0]);
    case 2: return f.call(receiver, a[0], a[1]);
    case 3: return f.call(receiver, a[0], a[1], a[2]);
    case 4: return f.call(receiver, a[0], a[1], a[2], a[3]);
    default: return f.call(receiver, a[0], a[1], a[2], a[3], a[4]);
  }
}
function attempt(call) {
  try { return show(call()); } catch (error) { return "throws " + error.constructor.name; }
}
for (let round = 0; round < 3; round++) {
  console.log("== round " + round);
  for (const name of Object.keys(candidates)) {
    const [f, receiver] = candidates[name];
    const line = [];
    for (const list of argumentLists) {
      line.push(attempt(() => callPlain(f, list)));
      line.push(attempt(() => callWithReceiver(f, receiver, list)));
      line.push(attempt(() => callAsMethod({ method: f, a: 1 }, list)));
    }
    console.log(name + ": " + line.join(" | "));
  }
}
