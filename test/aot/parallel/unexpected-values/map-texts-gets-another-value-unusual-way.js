// A map of texts gets another value by an unusual way.
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

function sizeOf(map, key) {
  return map.get(key).length;
}

function shoutAll(map) {
  const seen = [];
  for (const [key, value] of map) {
    try {
      seen.push(key.toUpperCase() + "=" + value.toUpperCase());
    } catch (error) {
      seen.push(error.constructor.name);
    }
  }
  return seen;
}

function totalOfSet(set) {
  let total = 0;
  for (const value of set) total += value.length;
  return total;
}

function keysJoined(map) {
  return [...map.keys()].map(key => typeof key).join(",");
}

function check(label, change) {
  let map = new Map([["a", "ada"], ["g", "grace"]]);
  let set = new Set(["ada", "grace"]);
  let outcome = "";
  try {
    const changed = change(map, set);
    if (changed) [map, set] = changed;
  } catch (error) {
    outcome = " (the change threw " + error.constructor.name + ")";
  }
  const parts = [];
  for (const use of [() => sizeOf(map, "a"), () => shoutAll(map), () => totalOfSet(set), () => keysJoined(map)]) {
    try {
      parts.push(show(use()));
    } catch (error) {
      parts.push("threw " + error.constructor.name);
    }
  }
  console.log(label + outcome + " -> " + parts.join(" | "));
}

for (let i = 0; i < 2000; i++) {
  const map = new Map([["a", "ada"], ["g", "grace"]]);
  sizeOf(map, "a");
  shoutAll(map);
  totalOfSet(new Set(["ada", "grace"]));
  keysJoined(map);
}

const five = make("5");
const list = make("['a', 'd']");

check("nothing is changed", () => {});
check("set", (map, set) => { map.set("a", five); set.add(five); });
check("set with a list", (map, set) => { map.set("a", list); set.add(list); });
check("set by call", (map, set) => { Map.prototype.set.call(map, "a", five); Set.prototype.add.call(set, five); });
check("set by apply", (map, set) => { map.set.apply(map, ["a", five]); set.add.apply(set, [five]); });
check("set by a computed name", (map, set) => { map[make("'set'")]("a", five); set[make("'add'")](five); });
check("set by a spread", (map, set) => { map.set(...["a", five]); set.add(...[five]); });
check("set by Reflect.apply", (map, set) => { Reflect.apply(Map.prototype.set, map, ["a", five]); Reflect.apply(Set.prototype.add, set, [five]); });
check("set by a bound function", (map, set) => { map.set.bind(map, "a")(five); set.add.bind(set)(five); });
check("set handed to forEach", (map, set) => { [five].forEach(set.add, set); [["a", five]].forEach(([key, value]) => map.set(key, value)); });
check("a key that is a number", map => { map.set(five, "five"); });
check("a key that is a wrapped text", map => { map.set(new String("a"), "wrapped"); });
check("a key that is missing", map => { map.delete("a"); });
check("cleared", (map, set) => { map.clear(); set.clear(); });
check("made from a list from eval", () => [new Map(make("[['a', 5], [6, 'six']]")), new Set(make("['ada', 5]"))]);
check("made from another map", map => { map.set("a", five); return [new Map(map), new Set(map.values())]; });
check("made from a generator", () => [new Map((function* () { yield ["a", five]; })()), new Set((function* () { yield five; })())]);
check("made from a text", () => [new Map([["a", "x"]]), new Set("ada")]);
check("made by groupBy", () => [Map.groupBy(["ada", "grace"], name => name[0]), new Set(["ada"])]);
check("made by structuredClone", (map, set) => { map.set("a", new String("ada")); set.add(new String("x")); return [structuredClone(map), structuredClone(set)]; });
check("a subclass that answers otherwise", () => [new (class extends Map { get() { return five; } })([["a", "ada"]]), new (class extends Set { *[Symbol.iterator]() { yield five; } })(["ada"])]);
check("an own get", map => { map.get = () => list; });
check("an own iterator", (map, set) => { map[Symbol.iterator] = function* () { yield [five, five]; }; set[Symbol.iterator] = function* () { yield list; }; });
check("a look-alike", () => [{ get: () => five, keys: () => [five], [Symbol.iterator]: () => [["k", five]][Symbol.iterator]() }, [five, "ab"]]);
check("an object in place of the map", () => [{ a: "ada" }, { 0: "ada" }]);
check("changed while it is walked", (map, set) => {
  for (const [key] of map) if (map.size < 5) map.set(key + "!", five);
  for (const value of set) if (set.size < 4) set.add(five + set.size);
});
check("through eval", (map, set) => { globalThis.mapForEval = map; (0, eval)("mapForEval.set('a', 5)"); delete globalThis.mapForEval; });
check("wrapped texts", (map, set) => { map.set("a", new String("ada")); set.add(new String("grace")); });
check("null and undefined", (map, set) => { map.set("a", null); set.add(undefined); });
