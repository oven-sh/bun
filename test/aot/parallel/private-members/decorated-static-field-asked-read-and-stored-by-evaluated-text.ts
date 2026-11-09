// A decorated static private field. `bun <file>` lowers the private name away: it refuses the stores below at the start ("SyntaxError: Left side of assignment is not a reference"), and without them the text of a direct eval cannot name the field ("SyntaxError: Cannot reference undeclared private names"). An executable keeps the name. There the text asks for the field before its value, reads it and stores to it as compiled code of the same class does, on the class, a subclass and an object of no class. The stored output is that of the executable.
// Todo: "other" | "same": a wrong answer today: under `bun build --compile --aot` it prints "other", where the stored output says "same". The engine that Bun pins hands evaluated text a static private field as a static accessor. oven-sh/WebKit#1020 hands it over as a field: the line goes out with the pin that has it
const lines: string[] = [];
function outcome(run: () => unknown) {
  try {
    return String(run());
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
}
function both(label: string, text: () => unknown, compiled: () => unknown) {
  const ofCompiled = outcome(compiled);
  lines.push(
    label +
      ": the text does the " +
      (outcome(text) === ofCompiled ? "same" : "other") +
      ". Compiled code: " +
      ofCompiled,
  );
}
function keep(_value: undefined, _context: ClassFieldDecoratorContext) {
  return (initial: any) => initial;
}
function doubled(_value: undefined, _context: ClassFieldDecoratorContext) {
  return (initial: any) => initial * 2;
}
class Held {
  static {
    both(
      "before the value, #held in this",
      () => eval("#held in this"),
      () => #held in this,
    );
    both(
      "before the value, a read",
      () => eval("this.#held"),
      () => this.#held,
    );
  }
  @keep static #held = 7;
  @doubled static #twice = 4;
  static ask(text: string, value: unknown) {
    return eval(text);
  }
  static reset() {
    Held.#held = 7;
    Held.#twice = 8;
  }
  static compiled: Record<string, (value: any) => unknown> = {
    "#held in value": value => #held in value,
    "#twice in value": value => #twice in value,
    "value.#held": value => value.#held,
    "value.#twice": value => value.#twice,
    "value.#held = 9": value => (value.#held = 9),
    "value.#twice += 1": value => (value.#twice += 1),
  };
}
class Below extends Held {}
// Before any store: 8 is what `doubled` made of 4. Every later probe stores first.
both(
  "the value that its decorator made, value.#twice, the class",
  () => Held.ask("value.#twice", Held),
  () => Held.compiled["value.#twice"](Held),
);
for (const text of Object.keys(Held.compiled)) {
  for (const [label, value] of [
    ["the class", Held],
    ["a subclass", Below],
    ["an object of no class", {}],
  ] as const) {
    both(
      text + ", " + label,
      () => (Held.reset(), Held.ask(text, value)),
      () => (Held.reset(), Held.compiled[text](value)),
    );
  }
}
console.log(lines.join("\n"));
/* Output:
before the value, #held in this: the text does the same. Compiled code: false
before the value, a read: the text does the same. Compiled code: TypeError: Cannot access invalid private field (evaluating 'this.#held')
the value that its decorator made, value.#twice, the class: the text does the same. Compiled code: 8
#held in value, the class: the text does the same. Compiled code: true
#held in value, a subclass: the text does the same. Compiled code: false
#held in value, an object of no class: the text does the same. Compiled code: false
#twice in value, the class: the text does the same. Compiled code: true
#twice in value, a subclass: the text does the same. Compiled code: false
#twice in value, an object of no class: the text does the same. Compiled code: false
value.#held, the class: the text does the same. Compiled code: 7
value.#held, a subclass: the text does the same. Compiled code: TypeError: Cannot access invalid private field (evaluating 'value.#held')
value.#held, an object of no class: the text does the same. Compiled code: TypeError: Cannot access invalid private field (evaluating 'value.#held')
value.#twice, the class: the text does the same. Compiled code: 8
value.#twice, a subclass: the text does the same. Compiled code: TypeError: Cannot access invalid private field (evaluating 'value.#twice')
value.#twice, an object of no class: the text does the same. Compiled code: TypeError: Cannot access invalid private field (evaluating 'value.#twice')
value.#held = 9, the class: the text does the same. Compiled code: 9
value.#held = 9, a subclass: the text does the same. Compiled code: TypeError: Cannot access invalid private field (evaluating 'value.#held = 9')
value.#held = 9, an object of no class: the text does the same. Compiled code: TypeError: Cannot access invalid private field (evaluating 'value.#held = 9')
value.#twice += 1, the class: the text does the same. Compiled code: 9
value.#twice += 1, a subclass: the text does the same. Compiled code: TypeError: Cannot access invalid private field (evaluating 'value.#twice')
value.#twice += 1, an object of no class: the text does the same. Compiled code: TypeError: Cannot access invalid private field (evaluating 'value.#twice')
*/
