// A string asked for an index behind its end and a table asked for an index that it lacks answer undefined. A compiled executable keeps String.prototype and Object.prototype as they are, so every way to
// put such an index there is refused, and the answers stay.
function at(base, key) { return base[key]; }
const bases = JSON.parse('["abc", "\\u4e16\\u754c", ""]');
bases.push({ 1: "one", 3: "three" }, { name: "no elements" });
const keys = JSON.parse('[1, 7, "7", 7.0, 8]');
function round(label) { console.log(label, bases.map(base => keys.map(key => String(at(base, key))).join(" ")).join(" | ")); }
round("before");
for (const [name, prototype] of [["String.prototype", String.prototype], ["Object.prototype", Object.prototype]]) {
  const tries = {
    "a store": () => { "use strict"; prototype[7] = "x"; },
    "Object.defineProperty": () => Object.defineProperty(prototype, 7, { value: "x", configurable: true }),
    "a getter": () => Object.defineProperty(prototype, 8, { get() { return "got"; }, configurable: true }),
    "Reflect.defineProperty": () => Reflect.defineProperty(prototype, 7, { value: "x", configurable: true }),
    "Reflect.set": () => Reflect.set(prototype, 7, "x"),
    "__defineGetter__": () => prototype.__defineGetter__(7, () => "x"),
    "Object.assign": () => Object.assign(prototype, { 7: "x" }),
    "Object.setPrototypeOf": () => Object.setPrototypeOf(prototype, { 7: "x" }),
  };
  for (const [way, attempt] of Object.entries(tries)) {
    let outcome;
    try { outcome = typeof attempt() === "boolean" ? "answered" : "returned"; } catch (error) { outcome = error.constructor.name; }
    round(name + ", " + way + ": " + outcome + ", " + (7 in prototype) + " " + (8 in prototype) + ":");
  }
}
