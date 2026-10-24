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

const Named = Base =>
  class extends Base {
    constructor(...inputs) {
      super(...inputs);
      this.title = "named";
    }
    describe() {
      return "named, " + super.describe();
    }
  };

const Counted = Base =>
  class extends Base {
    count = 0;
    bump() {
      return ++this.count;
    }
    describe() {
      return "counted " + this.count + ", " + super.describe();
    }
  };

const Quiet = Base => class extends Base {};

class Stores {
  constructor(amount) {
    this.amount = amount;
  }
  describe() {
    return "stores " + this.amount;
  }
}

class HasFields {
  amount = "field amount";
  extra = "field extra";
  describe() {
    return "has fields " + this.amount;
  }
}

class CallsOut {
  constructor(amount) {
    this.amount = amount;
    this.early = this.describe();
  }
  describe() {
    return "calls out " + this.amount;
  }
}

function Old(amount) {
  this.amount = amount;
}
Old.prototype.describe = function () {
  return "old " + this.amount;
};

function ReturnsLiteral(amount) {
  return { amount, describe: () => "a returned literal " + amount };
}
ReturnsLiteral.prototype.describe = function () {
  return "never reached";
};

class Listed extends Array {
  describe() {
    return "listed " + this.length;
  }
}

class Failed extends Error {
  describe() {
    return "failed " + this.message;
  }
}

const parents = [Stores, HasFields, CallsOut, Old, ReturnsLiteral, Listed, Failed];

const compositions = [
  ["Named", Base => Named(Base)],
  ["Counted", Base => Counted(Base)],
  ["Quiet", Base => Quiet(Base)],
  ["Named(Counted)", Base => Named(Counted(Base))],
  ["Counted(Named)", Base => Counted(Named(Base))],
  ["Quiet(Named(Quiet))", Base => Quiet(Named(Quiet(Base)))],
];

function describe(thing) {
  return thing.describe();
}

function amountOf(thing) {
  return thing.amount;
}

function bump(thing) {
  return thing.bump();
}

const Usual = Named(Counted(Stores));
let length = 0;
for (let i = 0; i < 2000; i++) {
  const usual = new Usual(i % 5);
  length += describe(usual).length + amountOf(usual) + bump(usual);
}
console.log("2000 honest rounds", length);

for (const Parent of parents) {
  for (const [label, compose] of compositions) {
    const where = label + " of " + Parent.name;
    let Made;
    attempt(where + ": define", () => ((Made = compose(Parent)), typeof Made));
    attempt(where + ": construct", () => { const made = new Made(3); return Array.isArray(made) ? ["a list of " + made.length, Object.keys(made)] : made; });
    attempt(where + ": describe()", () => describe(new Made(3)));
    attempt(where + ": amount", () => amountOf(new Made(3)));
    attempt(where + ": bump()", () => bump(new Made(3)));
    attempt(where + ": instanceof itself, the parent", () => [new Made(3) instanceof Made, new Made(3) instanceof Parent]);
  }
}

attempt("two results of one factory are different classes", () => [Named(Stores) === Named(Stores), new (Named(Stores))(1) instanceof Named(Stores)]);
attempt("a parent that is null", () => new (Quiet(null))());
attempt("a parent that is null, with a constructor", () => new (Named(null))());
attempt("a parent that is undefined", () => Quiet(undefined));
attempt("a parent that is an arrow function", () => Quiet(() => {}));
attempt("a parent that is a literal", () => Quiet({}));
attempt("a parent whose prototype is a number", () => Quiet(Object.assign(function () {}, { prototype: 5 })));
attempt("a parent that is a bound class", () => describe(new (Named(Stores.bind(null, "bound")))()));
attempt("a parent that is a proxy", () => describe(new (Counted(new Proxy(Stores, {})))(4)));
attempt("honest again", () => { const usual = new Usual(2); return [describe(usual), amountOf(usual), bump(usual), Object.keys(usual)]; });
