// Object.create(prototype, { [key]: { value } }) where the compiler knows that the key is a symbol or a string and not which one.
// STATISTIC: ObjectCreateDescriptorsExpanded >= 3
const seen = [];
const show = object => Reflect.ownKeys(object).map(key => String(key) + ":" + JSON.stringify(Object.getOwnPropertyDescriptor(object, key), (name, value) => (value instanceof Set ? "Set(" + [...value] + ")" : typeof value === "function" ? "function" : value === undefined ? "undefined" : value))).join(" ");
function tryTo(run) { try { return String(run()); } catch (error) { return error.constructor.name + ": " + error.message; } }
function makeTracker(name) {
  const EntitiesKey = Symbol(name);
  class Tracker {
    constructor() { this.paths = Object.create(null, { [EntitiesKey]: { value: new Set() } }); }
    entities(path) {
      let current = this.paths;
      for (const segment of path) current = current[segment] ||= Object.create(null, { [EntitiesKey]: { value: new Set() } });
      return current[EntitiesKey];
    }
  }
  return Tracker;
}
const trackers = [makeTracker("one"), makeTracker("two")];
for (const Tracker of trackers) {
  const tracker = new Tracker();
  tracker.entities(["a", "b"]).add(1); tracker.entities(["a"]).add(2); tracker.entities([]).add(3);
  seen.push(show(tracker.paths), show(tracker.paths.a), show(tracker.paths.a.b), String(Object.getPrototypeOf(tracker.paths)), Object.keys(tracker.paths).join());
}
function underString(name, value) { const key = String(name); return Object.create(null, { [key]: { value, enumerable: true, writable: true } }); }
for (const name of ["plain", "0", "4294967295", "__proto__", "", "constructor", "1.5", "-0"]) seen.push(show(underString(name, name.length)) + " | " + Object.keys(underString(name, 1)).join());
function underSymbol(key, prototype) { if (typeof key !== "symbol") return null; return Object.create(prototype, { [key]: { get() { return "got"; }, configurable: true } }); }
for (const key of [Symbol.iterator, Symbol.for("registered"), Symbol("made")]) seen.push(show(underSymbol(key, null)), String(underSymbol(key, {})[key]));
for (const prototype of [undefined, 1, "text"]) seen.push(tryTo(() => show(underSymbol(Symbol.iterator, prototype))));
function order(log) { const key = Symbol("k"); return Object.create((log.push("prototype"), null), { [(log.push("key"), key)]: { value: (log.push("value"), 1) } }); }
const log = []; seen.push(show(order(log)), log.join());
function unknownKey(key) { return Object.create(null, { [key]: { value: 1, enumerable: true } }); }
seen.push(show(unknownKey("x")), show(unknownKey(3)), show(unknownKey(Symbol.iterator)), show(unknownKey({ toString() { return "converted"; } })), show(unknownKey(null)), tryTo(() => unknownKey({ toString() { throw new RangeError("from toString"); } })));
function keptValue() { const kept = new Set([1]); const made = Object.create(null, { [Symbol.for("kept")]: { value: kept } }); kept.add(2); return made; }
seen.push(show(keptValue()));
function inTail(key) { if (typeof key !== "symbol") return; return Object.create(null, { [key]: { value: 5 } }); }
seen.push(show(inTail(Symbol.for("tail"))));
function underHandler(key, prototype) { try { if (typeof key !== "symbol") return "no symbol"; return show(Object.create(prototype, { [key]: { value: 6 } })); } catch (error) { return "caught " + error.constructor.name; } }
seen.push(underHandler(Symbol.for("h"), null), underHandler(Symbol.for("h"), 5));
let total = 0;
for (let i = 0; i < 20000; i++) { const each = new trackers[i & 1](); each.entities(["x"]).add(i); total += each.entities(["x"]).size + each.entities([]).size; }
seen.push(String(total));
console.log(seen.join("\n"));
