// Text that is evaluated reads a `static accessor` field, stores to it and asks for its name, before its value and after.
const lines = [];
function attempt(label, run) {
  try {
    lines.push(label + ": " + String(run()));
  } catch (error) {
    lines.push(label + ": " + error.name);
  }
}
class Registry {
  static before = [eval("#total in Registry"), #total in Registry];
  static readBefore = attempt("read before the value", () => eval("Registry.#total"));
  static storeBefore = attempt("store before the value", () => eval("Registry.#total = 5"));
  static {
    lines.push("a static block before it: " + eval("#total in this"));
  }
  static accessor #total = 7;
  static after = [eval("#total in Registry"), #total in Registry];
  static ask(text, value) {
    return eval(text);
  }
  static read() {
    return Registry.#total;
  }
}
class Below extends Registry {}
lines.push("before the value: " + JSON.stringify(Registry.before));
lines.push("after the value: " + JSON.stringify(Registry.after));
attempt("read", () => Registry.ask("Registry.#total"));
attempt("read through this", () => Registry.ask("this.#total"));
attempt("store", () => Registry.ask("Registry.#total = Registry.#total + 1"));
attempt("read by compiled code", () => Registry.read());
attempt("add", () => Registry.ask("Registry.#total += 10"));
attempt("increment", () => Registry.ask("Registry.#total++ + ' ' + Registry.#total"));
attempt("read by compiled code", () => Registry.read());
const values = [
  ["the class", Registry],
  ["a subclass", Below],
  ["an object of no class", {}],
  ["a number", 5],
  ["undefined", undefined],
];
for (const [label, value] of values) {
  attempt("has, " + label, () => Registry.ask("#total in value", value));
  attempt("read, " + label, () => Registry.ask("value.#total", value));
  attempt("store, " + label, () => Registry.ask("value.#total = 1", value));
}
const text = ["Regis", "try.#to", "tal += 100"].join("");
attempt("text put together at run time", () => Registry.ask(text) + " " + Registry.read());
console.log(lines.join("\n"));
