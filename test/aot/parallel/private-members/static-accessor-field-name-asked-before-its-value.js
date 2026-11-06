// `#name in value` for a `static accessor` field: a static field and a static block ask before its value. A subclass, an object of no class, a number and undefined are asked, read and stored to. The getter and the setter are on the class as soon as the class is
const lines = [];
function attempt(label, run) {
  try {
    lines.push(label + ": " + String(run()));
  } catch (error) {
    lines.push(label + ": " + error.name + ": " + error.message);
  }
}
class Registry {
  static before = #total in Registry;
  static {
    lines.push("a static block before it: " + (#total in this));
  }
  static accessor #total = 7;
  static after = #total in Registry;
  static has(value) {
    return #total in value;
  }
  static read(value) {
    return value.#total;
  }
  static store(value) {
    value.#total = 8;
    return value.#total;
  }
}
class Below extends Registry {}
lines.push("a static field before it: " + Registry.before + ", after it: " + Registry.after);
const values = [
  ["the class", Registry],
  ["a subclass", Below],
  ["an object of no class", {}],
  ["a number", 5],
  ["undefined", undefined],
];
for (const [label, value] of values) {
  attempt("has, " + label, () => Registry.has(value));
  attempt("read, " + label, () => Registry.read(value));
  attempt("store, " + label, () => Registry.store(value));
}
console.log(lines.join("\n"));
