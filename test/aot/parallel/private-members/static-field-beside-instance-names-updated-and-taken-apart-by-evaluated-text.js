// A class has an instance private field, a private method and a static private field. Text that eval runs in a static method and in a method updates the static field, stores to it from a pattern and from the head of a loop, and calls it as a tag. On the class, on an object of the class and on an object of no class it does what compiled code of the class does for the same expression: the field changes as the form says, or a TypeError has the words of a field.
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
const tag = parts => "tagged " + parts[0];
class Mixed {
  #own = 1;
  #double() {
    return this.#own * 2;
  }
  static #shared = 10;
  static ask(text, value) {
    return eval(text);
  }
  ask(text, value) {
    return eval(text);
  }
  static then(run) {
    Mixed.#shared = 10;
    const result = String(run());
    return result + ", and the field is then " + (Mixed.#shared === tag ? "the tag" : String(Mixed.#shared));
  }
  static compiled = {
    "++value.#shared": value => ++value.#shared,
    "value.#shared--": value => value.#shared--,
    "value.#shared += 5": value => (value.#shared += 5),
    "value.#shared &&= 7": value => (value.#shared &&= 7),
    "({ a: value.#shared } = { a: 30 })": value => ({ a: value.#shared } = { a: 30 }),
    "for (value.#shared of [40]);": value => {
      for (value.#shared of [40]);
    },
    "for (value.#shared in { key: 1 });": value => {
      for (value.#shared in { key: 1 });
    },
    "(value.#shared = tag), value.#shared`x`": value => ((value.#shared = tag), value.#shared`x`),
    "[this?.#own, this?.#double?.(), #own in value, #double in value, #shared in value]": function (value) {
      return [this?.#own, this?.#double?.(), #own in value, #double in value, #shared in value];
    },
  };
}
const values = [
  ["the class", Mixed],
  ["an object of the class", new Mixed()],
  ["an object of no class", {}],
];
for (const text of Object.keys(Mixed.compiled)) {
  for (const [label, value] of values) {
    both(
      text + ", " + label + ", in a static method",
      () => Mixed.then(() => Mixed.ask(text, value)),
      () => Mixed.then(() => Mixed.compiled[text].call(Mixed, value)),
    );
    const object = new Mixed();
    both(
      text + ", " + label + ", in a method",
      () => Mixed.then(() => object.ask(text, value)),
      () => Mixed.then(() => Mixed.compiled[text].call(object, value)),
    );
  }
}
console.log(lines.join("\n"));
