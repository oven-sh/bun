function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "-> threw", error.constructor.name);
  }
}

function describeThis() {
  return [typeof this, this + 1, this * 2, this | 0, this === 5, this == 5, this instanceof Number];
}

function doubledThis() {
  return this * 2;
}

function truthOfThis() {
  return this ? "truthy" : "falsy";
}

function kindOfThis() {
  return this === undefined ? "undefined" : this === null ? "null" : typeof this;
}

Number.prototype.describe = describeThis;
Number.prototype.doubled = doubledThis;
Number.prototype.truth = truthOfThis;
Object.defineProperty(Number.prototype, "half", {
  get() {
    return [typeof this, this / 2];
  },
  configurable: true,
});

for (let i = 0; i < 2000; i++) {
  doubledThis.call(i);
  i.doubled();
}

attempt("(5).describe()", () => (5).describe());
attempt("describeThis.call(5)", () => describeThis.call(5));
attempt("describeThis.call('5')", () => describeThis.call("5"));
attempt("describeThis.call(5n)", () => describeThis.call(5n));
attempt("describeThis.call(true)", () => describeThis.call(true));
attempt("describeThis.call(new Number(5))", () => describeThis.call(new Number(5)));
attempt("describeThis.apply(5.5)", () => describeThis.apply(5.5));
attempt("describeThis.bind(5)()", () => describeThis.bind(5)());
attempt("(0).truth()", () => (0).truth());
attempt("truthOfThis.call(0)", () => truthOfThis.call(0));
attempt("truthOfThis.call(NaN)", () => truthOfThis.call(NaN));
attempt("truthOfThis.call('')", () => truthOfThis.call(""));
attempt("truthOfThis.call(false)", () => truthOfThis.call(false));
attempt("(5).half", () => (5).half);
attempt("(-0).doubled()", () => (-0).doubled());
attempt("(2147483647).doubled()", () => (2147483647).doubled());
attempt("doubledThis.call('4')", () => doubledThis.call("4"));
attempt("doubledThis.call(null)", () => doubledThis.call(null));
attempt("doubledThis()", () => doubledThis());
attempt("kindOfThis()", () => kindOfThis());
attempt("kindOfThis.call(undefined)", () => kindOfThis.call(undefined));
attempt("kindOfThis.call(null)", () => kindOfThis.call(null));
attempt("kindOfThis.call(0)", () => kindOfThis.call(0));
attempt("as a callback with a number for this", () => [1, 2].map(doubledThis, 21));
attempt("as a callback without this", () => [1].map(kindOfThis));
attempt("a member stored on a number throws", () => {
  const n = 5;
  n.extra = 1;
  return n.extra;
});
