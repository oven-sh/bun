// Text that eval runs in a static method asks for a static private field, reads it, stores to it and updates it, on the class and on a value that is not the class: a subclass, an object of no class, a number, null and undefined. It answers and throws as compiled code of the class does for the same expression, with the words of a field.
// Todo: "other" | "same": a wrong answer today: under `bun build --compile --aot` it prints "other", where `bun <file>` prints "same". The engine that Bun pins hands evaluated text a static private field as a static accessor. oven-sh/WebKit#1020 hands it over as a field: the line goes out with the pin that has it
const lines = [];
function outcome(run) {
  try {
    return String(run());
  } catch (error) {
    return error.name + ": " + error.message;
  }
}
function both(label, text, compiled) {
  const ofCompiled = outcome(compiled);
  lines.push(
    label +
      ": the text does the " +
      (outcome(text) === ofCompiled ? "same" : "other") +
      ". Compiled code: " +
      ofCompiled,
  );
}
class Registry {
  static #total = 7;
  static ask(text, value) {
    return eval(text);
  }
  static reset() {
    Registry.#total = 7;
  }
  static compiled = {
    "#total in value": value => #total in value,
    "value.#total": value => value.#total,
    "value.#total = 9": value => (value.#total = 9),
    "value.#total++": value => value.#total++,
    "value.#total += 2": value => (value.#total += 2),
    "value?.#total": value => value?.#total,
  };
}
class Below extends Registry {}
const values = [
  ["the class", Registry],
  ["a subclass", Below],
  ["an object of no class", {}],
  ["a number", 5],
  ["null", null],
  ["undefined", undefined],
];
for (const [label, value] of values) {
  for (const text of Object.keys(Registry.compiled)) {
    both(
      text + ", " + label,
      () => (Registry.reset(), Registry.ask(text, value)),
      () => (Registry.reset(), Registry.compiled[text](value)),
    );
  }
}
both(
  "a store by the text, read by compiled code",
  () => (Registry.ask("value.#total = 11", Registry), Registry.compiled["value.#total"](Registry)),
  () => 11,
);
both(
  "a store by compiled code, read by the text",
  () => (Registry.reset(), Registry.ask("value.#total", Registry)),
  () => 7,
);
console.log(lines.join("\n"));
