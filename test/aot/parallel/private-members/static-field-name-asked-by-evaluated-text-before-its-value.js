// Text that eval runs before a static private field has its value asks `#name in` the class, reads the field and stores to it. It answers and throws as compiled code does in the same place: a static block, an earlier static initializer, the field's own initializer, a constructor that runs early and a static method whose one text asks before and after. A static private method beside the field is on the class from the start. A function, an arrow and a class that the text made answer as compiled code once the value is there, and for a class whose body threw first.
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
let later;
class Early {
  static #step() {
    return 1;
  }
  static probe() {
    return eval("#count in this");
  }
  static has() {
    return #count in this;
  }
  static pair() {
    return [#count in this, this.#count];
  }
  constructor() {
    both(
      "a constructor that runs early",
      () => eval("#count in Early"),
      () => #count in Early,
    );
  }
  static before = both(
    "an earlier static initializer",
    () => eval("#count in this"),
    () => #count in this,
  );
  static made = new Early();
  static {
    both(
      "a static block",
      () => eval("#count in this"),
      () => #count in this,
    );
    both(
      "a text in the text",
      () => eval("eval('#count in this')"),
      () => #count in this,
    );
    both(
      "a static method with one text",
      () => this.probe(),
      () => this.has(),
    );
    both(
      "a static method beside the field",
      () => eval("#step in this"),
      () => #step in this,
    );
    both(
      "a read",
      () => eval("this.#count"),
      () => this.#count,
    );
    both(
      "a store",
      () => eval("this.#count = 5"),
      () => (this.#count = 5),
    );
    later = [
      eval("() => [#count in this, this.#count]"),
      eval("(function () { return [#count in Early, Early.#count]; })"),
      eval("(class { static ask(value) { return [#count in value, value.#count]; } })"),
    ];
  }
  static #count =
    (both(
      "its own initializer",
      () => eval("#count in this"),
      () => #count in this,
    ),
    1);
  static after = both(
    "a later static initializer",
    () => eval("#count in this"),
    () => #count in this,
  );
}
both(
  "the static method with the same text, after the value",
  () => Early.probe(),
  () => Early.has(),
);
both(
  "an arrow of the text, called after the value",
  () => later[0](),
  () => Early.pair(),
);
both(
  "a function of the text, called after the value",
  () => later[1](),
  () => Early.pair(),
);
both(
  "a class of the text, asked after the value",
  () => later[2].ask(Early),
  () => Early.pair(),
);
let escaped;
try {
  class Broken {
    static {
      escaped = [eval("() => [#late in Broken, #late in this]"), () => [#late in Broken, #late in this]];
    }
    static stop = (() => {
      throw new Error("the class body stops here");
    })();
    static #late = 1;
  }
} catch (error) {
  lines.push("a class body threw: " + error.message);
}
both(
  "an arrow of the text of that class",
  () => escaped[0](),
  () => escaped[1](),
);
console.log(lines.join("\n"));
