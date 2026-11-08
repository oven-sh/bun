// A class in a function is made twice, and each class has a static private field of its own. Text that eval runs in one class asks for the field before its value, reads it and stores to it on its own class, and is refused on the other class with the words of a field. It does what compiled code of that class does for the same expression.
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
function make(tag) {
  return class Tagged {
    static {
      both(
        "#tag in this, before the value of the " + tag,
        () => eval("#tag in this"),
        () => #tag in this,
      );
    }
    static #tag = tag;
    static ask(text, value) {
      return eval(text);
    }
    static reset() {
      Tagged.#tag = tag;
    }
    static compiled = {
      "#tag in value": value => #tag in value,
      "value.#tag": value => value.#tag,
      'value.#tag = "stored"': value => (value.#tag = "stored"),
    };
  };
}
const first = make("first");
const second = make("second");
for (const text of Object.keys(first.compiled)) {
  both(
    text + ", the first on itself",
    () => (first.reset(), first.ask(text, first)),
    () => (first.reset(), first.compiled[text](first)),
  );
  both(
    text + ", the first on the second",
    () => first.ask(text, second),
    () => first.compiled[text](second),
  );
}
both(
  "a store by the text of the first, read by its compiled code",
  () => (first.ask('value.#tag = "kept"', first), first.compiled["value.#tag"](first)),
  () => "kept",
);
both(
  "the second is as it was",
  () => second.ask("value.#tag", second),
  () => second.compiled["value.#tag"](second),
);
console.log(lines.join("\n"));
