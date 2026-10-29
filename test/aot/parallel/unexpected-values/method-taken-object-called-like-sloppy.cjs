// A method taken off its object is called like a function sloppy.
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function describe(self) {
  if (self === undefined) return "undefined";
  if (self === null) return "null";
  if (self === globalThis) return "the global object";
  return typeof self + " " + Object.prototype.toString.call(self).slice(8, -1) + " " + (typeof self === "symbol" ? "symbol" : self.label ?? String(self));
}

function who() {
  return describe(this);
}

who.label = "the function who";

function whoWithArguments(a, b) {
  return describe(this) + " " + a + " " + b;
}

function sameAsGiven(given) {
  return this === given;
}

const holder = {
  label: "holder",
  who,
  throughArrow() {
    return (() => describe(this))();
  },
  throughInner() {
    function inner() {
      return describe(this);
    }
    return inner();
  },
  get asGetter() {
    return describe(this);
  },
};

class Tool {
  label = "tool";
  who() {
    return describe(this);
  }
  static who() {
    return describe(this === Tool ? "the class" : this);
  }
}

function honest(round) {
  console.log(round, holder.who(), "|", holder.who(), "|", new Tool().who(), "|", Tool.who(), "|", holder.throughArrow(), "|", holder.asGetter);
}

console.log("strict:", (function () { return this === undefined; })());
honest("before");
attempt("who()", () => who());
attempt("holder.who()", () => holder.who());
attempt("(holder.who)()", () => (holder.who)());
attempt("(0, holder.who)()", () => (0, holder.who)());
attempt("(holder.who = holder.who)()", () => (holder.who = holder.who)());
attempt("(holder.who || 0)()", () => (holder.who || 0)());
attempt("(true ? holder.who : 0)()", () => (true ? holder.who : 0)());
attempt("holder['who']()", () => holder["who"]());
attempt("holder?.who()", () => holder?.who());
attempt("holder.who?.()", () => holder.who?.());
attempt("(holder?.who)()", () => (holder?.who)());
attempt("taken off into a variable", () => { const taken = holder.who; return taken(); });
attempt("taken off by destructuring", () => { const { who: taken } = holder; return taken(); });
attempt("taken off a class instance", () => { const taken = new Tool().who; return taken(); });
attempt("taken off the class", () => { const taken = Tool.who; return taken(); });
attempt("put on another object", () => ({ label: "another", who: holder.who }).who());
attempt("an element of an array", () => Object.assign([holder.who], { label: "the array" })[0]());
attempt("as a tag", () => who`x`);
attempt("as a tag on its holder", () => holder.who`x`);
attempt("with new", () => typeof new who());
attempt("an arrow function inside a method", () => holder.throughArrow());
attempt("an arrow function inside a method taken off", () => (0, holder.throughArrow)());
attempt("a function inside a method", () => holder.throughInner());
attempt("a getter through an heir", () => Object.assign(Object.create(holder), { label: "heir" }).asGetter);
attempt("a getter through Reflect.get with a receiver", () => Reflect.get(holder, "asGetter", 5));

const selves = [
  ["undefined", undefined],
  ["null", null],
  ["a number", 5],
  ["zero", 0],
  ["a string", "text"],
  ["an empty string", ""],
  ["true", true],
  ["false", false],
  ["a symbol", Symbol.iterator],
  ["a BigInt", 5n],
  ["an object", { label: "given" }],
  ["an array", [1, 2]],
  ["a function", who],
];

for (const [name, self] of selves) {
  attempt("who.call(" + name + ")", () => who.call(self));
  attempt("who.apply(" + name + ")", () => who.apply(self));
  attempt("who.bind(" + name + ")()", () => who.bind(self)());
  attempt("Reflect.apply(who, " + name + ")", () => Reflect.apply(who, self, []));
  attempt("[1].map(who, " + name + ")", () => [1].map(who, self)[0]);
  attempt("whoWithArguments.call(" + name + ", 1, 2)", () => whoWithArguments.call(self, 1, 2));
  attempt("the very same value arrives, " + name, () => sameAsGiven.call(self, self));
  attempt("holder.who.call(" + name + ")", () => holder.who.call(self));
  attempt("a class's method with " + name, () => Tool.prototype.who.call(self));
}
attempt("as a callback of map", () => [1].map(who)[0]);
attempt("as a callback of forEach", () => { let seen; [1].forEach(function () { seen = describe(this); }); return seen; });
attempt("as a comparator", () => { let seen; [2, 1].sort(function (a, b) { seen = describe(this); return a - b; }); return seen; });
attempt("as a replacer", () => "a".replace("a", who));
attempt("as a reviver", () => JSON.parse("1", function (key, value) { return describe(this); }));
attempt("as toJSON", () => JSON.stringify({ label: "serialized", toJSON: who }));
attempt("as valueOf", () => `${{ label: "converted", toString: who }}`);
attempt("from hidden code", () => new Function("f", "return f()")(who));
attempt("from hidden code as a method", () => new Function("o", "return o.who()")(holder));
attempt("from hidden code inside with", () => new Function("o", "with (o) { return who(); }")(holder));
honest("after");
