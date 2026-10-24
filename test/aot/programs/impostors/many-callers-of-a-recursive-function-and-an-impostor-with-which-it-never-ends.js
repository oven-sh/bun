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

function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

function isEven(n) {
  return n === 0 ? true : !isOdd(n - 1) === false;
}

function isOdd(n) {
  return n === 0 ? false : !isEven(n - 1) === false;
}

function lengthOf(list) {
  return list.length === 0 ? 0 : 1 + lengthOf(list.slice(1));
}

function honest(round) {
  console.log(round, "factorial", factorial(0), factorial(1), factorial(5), factorial(10));
  console.log(round, "isEven", isEven(0), isEven(1), isEven(10), isOdd(7));
  console.log(round, "lengthOf", lengthOf([]), lengthOf([1]), lengthOf([1, 2, 3]), lengthOf("abc"));
}

honest("before");
attempt("factorial of undefined", () => factorial(undefined));
honest("after the first");
attempt("factorial of NaN", () => factorial(NaN));
attempt("factorial of a word", () => factorial("five"));
attempt("factorial of an object", () => factorial({}));
attempt("isEven of a fraction", () => isEven(2.5));
attempt("isEven of minus one", () => isEven(-1));
attempt("isOdd of undefined", () => isOdd(undefined));
attempt("lengthOf an object whose slice answers itself", () => lengthOf({ length: 1, slice() { return this; } }));
attempt("factorial of undefined as a callback", () => [undefined].map(factorial));
attempt("factorial of undefined from hidden code", () => new Function("f", "return f()")(factorial));
honest("after");
