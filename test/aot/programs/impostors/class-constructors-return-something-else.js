function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

class Other {
  constructor() {
    this.amount = "other amount";
  }
  double() {
    return "doubled by Other";
  }
}

const kept = { amount: "kept amount" };
const answers = {
  nothing: undefined,
  number: 5,
  string: "text",
  null: null,
  boolean: false,
  symbol: Symbol.for("answer"),
  literal: { amount: "literal amount" },
  kept,
  other: new Other(),
  array: [1, 2],
  function: function answer() {},
  frozen: Object.freeze({ amount: "frozen amount" }),
  bare: Object.create(null),
};

class Base {
  constructor(amount, answer) {
    this.amount = amount;
    return answers[answer];
  }
  double() {
    return this.amount * 2;
  }
}

class Derived extends Base {
  constructor(amount, answer) {
    super(amount, "nothing");
    this.extra = "extra";
    return answers[answer];
  }
}

class OverBase extends Base {
  constructor(amount, answer) {
    super(amount, answer);
    this.extra = "extra";
  }
}

class FieldsOverBase extends Base {
  extra = "field";
  #mark = "marked";
  static markOf(thing) {
    return #mark in thing ? thing.#mark : "no mark";
  }
}

class NoSuper extends Base {
  constructor(amount, answer) {
    return answers[answer];
  }
}

function make(Maker, amount, answer) {
  return new Maker(amount, answer);
}

function amountOf(thing) {
  return thing.amount;
}

function doubleOf(thing) {
  return thing.double();
}

const makers = [Base, Derived, OverBase, FieldsOverBase, NoSuper];

let sum = 0;
for (let i = 0; i < 2000; i++) {
  for (const Maker of makers) {
    if (Maker === NoSuper) continue;
    const thing = make(Maker, i % 10, "nothing");
    sum += amountOf(thing) + doubleOf(thing);
  }
}
console.log("2000 honest constructions each", sum);

for (const Maker of makers) {
  for (const answer of Object.keys(answers)) {
    const label = Maker.name + " returns " + answer;
    let made;
    attempt(label + ": made", () => { made = undefined; made = make(Maker, 21, answer); return typeof made === "function" ? "a function" : made; });
    if (made === undefined) continue;
    attempt(label + ": instanceof, is what was returned", () => [made instanceof Maker, made === answers[answer]]);
    attempt(label + ": amount, double()", () => { let doubled; try { doubled = doubleOf(made); } catch (error) { doubled = error.constructor.name; } return [amountOf(made), doubled]; });
    if (Maker === FieldsOverBase) attempt(label + ": mark", () => FieldsOverBase.markOf(made));
    delete kept.extra;
    delete answers.literal.extra;
    delete answers.other.extra;
    delete answers.array.extra;
    delete answers.function.extra;
    delete answers.bare.extra;
  }
  if (Maker !== NoSuper) attempt(Maker.name + ": honest again", () => doubleOf(make(Maker, 21, "nothing")));
}
