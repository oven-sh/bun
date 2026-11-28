// No direct eval is in this program, so the build removes what compiled code calls for one. Text of `new Function` still runs in the interpreter. It asks for private names on values that do not have them, reads them and stores to them, for a class of its own and through a compiled class: each answer and each TypeError is that of `bun <file>`.
function outcome(run) {
  try {
    return String(run());
  } catch (error) {
    return error.name + ": " + error.message;
  }
}
const ofText = new Function(
  "outcome",
  `
  class Interpreted {
    #own = 1;
    static #shared = 2;
    static forms = {
      "#own in value": value => #own in value,
      "#shared in value": value => #shared in value,
      "value.#own": value => value.#own,
      "value.#shared": value => value.#shared,
      "value.#own = 5": value => (value.#own = 5),
      "value.#shared = 6": value => (value.#shared = 6),
    };
  }
  const values = [["an object of the class", new Interpreted()], ["the class", Interpreted], ["an object of no class", {}], ["another class", class {}], ["a number", 5]];
  const lines = [];
  for (const form of Object.keys(Interpreted.forms)) {
    for (const [label, value] of values) lines.push("a class of the text: " + form + ", " + label + ": " + outcome(() => Interpreted.forms[form](value)));
  }
  return lines;
`,
);
class Compiled {
  #own = 1;
  static #shared = 2;
  static forms = {
    "#own in value": value => #own in value,
    "#shared in value": value => #shared in value,
    "value.#own": value => value.#own,
    "value.#shared": value => value.#shared,
    "value.#own = 5": value => (value.#own = 5),
    "value.#shared = 6": value => (value.#shared = 6),
  };
}
const throughText = new Function(
  "outcome",
  "Compiled",
  `
  const values = [["an object of the class", new Compiled()], ["the class", Compiled], ["an object of no class", {}], ["another class", class {}], ["a number", 5]];
  const lines = [];
  for (const form of Object.keys(Compiled.forms)) {
    for (const [label, value] of values) lines.push("a compiled class, called by the text: " + form + ", " + label + ": " + outcome(() => Compiled.forms[form](value)));
  }
  return lines;
`,
);
console.log(ofText(outcome).concat(throughText(outcome, Compiled)).join("\n"));
