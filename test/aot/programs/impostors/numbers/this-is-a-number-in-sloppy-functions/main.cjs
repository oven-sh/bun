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

function thisOrGlobal() {
  return this === globalThis ? "the global object" : typeof this;
}

Number.prototype.describe = describeThis;
Number.prototype.doubled = doubledThis;
Number.prototype.truth = truthOfThis;
Object.defineProperty(Number.prototype, "half", {
  get: function () {
    return [typeof this, this / 2];
  },
  configurable: true,
});

for (var i = 0; i < 2000; i++) {
  doubledThis.call(i);
  i.doubled();
}

attempt("(5).describe()", function () { return (5).describe(); });
attempt("describeThis.call(5)", function () { return describeThis.call(5); });
attempt("describeThis.call('5')", function () { return describeThis.call("5"); });
attempt("describeThis.call(5n)", function () { return describeThis.call(5n); });
attempt("describeThis.call(true)", function () { return describeThis.call(true); });
attempt("describeThis.call(new Number(5))", function () { return describeThis.call(new Number(5)); });
attempt("describeThis.apply(5.5)", function () { return describeThis.apply(5.5); });
attempt("describeThis.bind(5)()", function () { return describeThis.bind(5)(); });
attempt("(0).truth()", function () { return (0).truth(); });
attempt("truthOfThis.call(0)", function () { return truthOfThis.call(0); });
attempt("truthOfThis.call(NaN)", function () { return truthOfThis.call(NaN); });
attempt("truthOfThis.call('')", function () { return truthOfThis.call(""); });
attempt("truthOfThis.call(false)", function () { return truthOfThis.call(false); });
attempt("(5).half", function () { return (5).half; });
attempt("(-0).doubled()", function () { return (-0).doubled(); });
attempt("(2147483647).doubled()", function () { return (2147483647).doubled(); });
attempt("doubledThis.call('4')", function () { return doubledThis.call("4"); });
attempt("doubledThis.call(null) uses the global object", function () { return doubledThis.call(null); });
attempt("doubledThis() uses the global object", function () { return doubledThis(); });
attempt("thisOrGlobal()", function () { return thisOrGlobal(); });
attempt("thisOrGlobal.call(undefined)", function () { return thisOrGlobal.call(undefined); });
attempt("thisOrGlobal.call(null)", function () { return thisOrGlobal.call(null); });
attempt("thisOrGlobal.call(0)", function () { return thisOrGlobal.call(0); });
attempt("as a callback with a number for this", function () { return [1, 2].map(doubledThis, 21); });
attempt("as a callback without this", function () { return [1].map(thisOrGlobal); });
attempt("a member stored on a number is lost", function () {
  var n = 5;
  n.extra = 1;
  return n.extra;
});
