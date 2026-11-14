// A class inside a class: text that eval runs in the inner class names the static private field of the outer class and its own. Each name leads to the class that declares it: where both classes use one name, where the outer class uses the name for an instance field, where the inner class has no name of its own, before the outer field has its value, and where a computed key runs the text before its class is there. It does what compiled code in the same place does.
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
class Outer {
  static #outer = "of the outer class";
  static #shared = "shared, of the outer class";
  #mixed = "an instance field of the outer class";
  static Inner = class Inner {
    static {
      both(
        "before the value of the later field of the outer class",
        () => eval("[#late in Outer, #late in this]"),
        () => [#late in Outer, #late in this],
      );
      both(
        "a read of it there",
        () => eval("Outer.#late"),
        () => Outer.#late,
      );
    }
    static #inner = "of the inner class";
    static #shared = "shared, of the inner class";
    static #mixed = "a static field of the inner class";
    static ask(text, value) {
      return eval(text);
    }
    static reset() {
      Inner.#shared = "shared, of the inner class";
    }
    static compiled = {
      "#outer in value": value => #outer in value,
      "#inner in value": value => #inner in value,
      "#shared in value": value => #shared in value,
      "#mixed in value": value => #mixed in value,
      "#late in value": value => #late in value,
      "value.#outer": value => value.#outer,
      "value.#inner": value => value.#inner,
      "value.#shared": value => value.#shared,
      "value.#mixed": value => value.#mixed,
      'value.#outer += "!"': value => (value.#outer += "!"),
      'value.#shared += "!"': value => (value.#shared += "!"),
      "[Outer.#outer, Outer.#late, Inner.#inner, Inner.#shared, Inner.#mixed]": () => [
        Outer.#outer,
        Outer.#late,
        Inner.#inner,
        Inner.#shared,
        Inner.#mixed,
      ],
    };
  };
  static Bare = class {
    static ask(text, value) {
      return eval(text);
    }
    static compiled = {
      "#outer in value": value => #outer in value,
      "value.#outer": value => value.#outer,
      'value.#outer = "stored"': value => (value.#outer = "stored"),
    };
  };
  static #late = "of the outer class, later";
  static reset() {
    Outer.#outer = "of the outer class";
    Outer.Inner.reset();
  }
  static outer() {
    return Outer.#outer;
  }
}
const values = [
  ["the outer class", Outer],
  ["the inner class", Outer.Inner],
  ["an object of the outer class", new Outer()],
  ["an object of no class", {}],
];
for (const [name, inner] of [
  ["the inner class", Outer.Inner],
  ["an inner class with no name of its own", Outer.Bare],
]) {
  for (const text of Object.keys(inner.compiled)) {
    for (const [label, value] of values) {
      both(
        "in " + name + ": " + text + ", " + label,
        () => (Outer.reset(), inner.ask(text, value)),
        () => (Outer.reset(), inner.compiled[text](value)),
      );
    }
  }
}
both(
  "a store by the text of the inner class, read by compiled code of the outer class",
  () => (Outer.Bare.ask('value.#outer = "kept"', Outer), Outer.outer()),
  () => "kept",
);
const early = [];
class Keyed {
  static #key = 1;
  static [(early.push(
    outcome(() => eval("#key in early")),
    outcome(() => #key in early),
    outcome(() => eval("early.#key")),
    outcome(() => early.#key),
    eval("value => [#key in value, value.#key]"),
    value => [#key in value, value.#key],
  ),
  "named")] = 1;
}
both(
  "a computed key, #key in an array",
  () => early[0],
  () => early[1],
);
both(
  "a computed key, a read on an array",
  () => early[2],
  () => early[3],
);
both(
  "an arrow of the text of a computed key, called after the value",
  () => early[4](Keyed),
  () => early[5](Keyed),
);
both(
  "the same arrow on an object of no class",
  () => early[4]({}),
  () => early[5]({}),
);
console.log(lines.join("\n"));
