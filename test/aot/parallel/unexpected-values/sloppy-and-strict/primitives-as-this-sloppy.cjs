console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

var uses = {
  kind: function () {
    return typeof this;
  },
  isSame: function (value) {
    return this === value;
  },
  isLooselySame: function (value) {
    return this == value;
  },
  store: function () {
    this.extra = 1;
    return this.extra;
  },
  plusOne: function () {
    return this + 1;
  },
  tag: function () {
    return Object.prototype.toString.call(this);
  },
  truth: function () {
    return this ? "truthy" : "falsy";
  },
  negated: function () {
    return !this;
  },
  size: function () {
    return this.length;
  },
  isObject: function () {
    return this instanceof Object;
  },
  itself: function () {
    return this;
  },
  twice: function () {
    return uses.itself.call(this) === uses.itself.call(this);
  },
};
var receivers = { five: 5, zero: 0, minusZero: -0, notANumber: NaN, text: "abc", emptyText: "", yes: true, no: false, big: 1n, bigZero: 0n, symbol: Symbol.iterator, none: null, nothing: undefined };

var honest = { length: 3 };
for (var i = 0; i < 2000; i++) for (var name in uses) uses[name].call(honest, honest);

for (var receiver in receivers) for (var use in uses) attempt(use + ".call(" + receiver + ")", uses[use].bind(receivers[receiver], receivers[receiver]));
for (var other of ["five", "text", "no", "none"]) {
  var value = receivers[other];
  attempt("kind.apply(" + other + ")", () => uses.kind.apply(value));
  attempt("Reflect.apply(kind, " + other + ")", () => Reflect.apply(uses.kind, value, []));
  attempt("forEach(kind, " + other + ")", () => {
    var seen;
    [0].forEach(function () {
      seen = [typeof this, this === value];
    }, value);
    return seen;
  });
  attempt("truth by map(" + other + ")", () => [0].map(uses.truth, value));
}
