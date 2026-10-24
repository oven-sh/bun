function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function renumber(list) {
  for (let i = 0; i < list.length; i++) list[i] = i * 10;
  return list.length;
}

function collect(list) {
  const seen = [];
  for (const value of list) seen.push(value);
  return seen;
}

for (let i = 0; i < 2000; i++) {
  sum([1, 2, 3]);
  renumber([1, 2, 3]);
  collect([1, 2, 3]);
}

function parameterStoredThenSummed(a, b, c) {
  a = 100;
  return sum(arguments);
}

function summedInPlace(a, b, c) {
  b = 100;
  let total = 0;
  for (let i = 0; i < arguments.length; i++) total += arguments[i];
  return total;
}

function renumberedByAHelper(a, b, c) {
  renumber(arguments);
  return [a, b, c];
}

function renumberedInPlace(a, b, c) {
  for (let i = 0; i < arguments.length; i++) arguments[i] = i * 10;
  return [a, b, c];
}

function fewerArgumentsThanParameters(a, b, c) {
  arguments[2] = "stored";
  c = "parameter";
  return [arguments.length, arguments[2], c, 2 in arguments];
}

function moreArgumentsThanParameters(a) {
  arguments[1] = "stored";
  return [a, arguments[1], arguments.length];
}

function deletedThenStored(a, b) {
  delete arguments[0];
  arguments[0] = "stored";
  a = "parameter";
  return [a, arguments[0]];
}

function lengthStored(a, b, c) {
  arguments.length = 1;
  return [collect(arguments), [...arguments], sum(arguments), arguments[2]];
}

function lengthGrown(a) {
  arguments.length = 3;
  return [collect(arguments), Array.from(arguments), Array.prototype.slice.call(arguments)];
}

function madeReadOnly(a) {
  Object.defineProperty(arguments, 0, { writable: false });
  a = "parameter";
  arguments[0] = "stored";
  return [a, arguments[0]];
}

function redefined(a) {
  Object.defineProperty(arguments, 0, { value: "defined" });
  const afterDefine = a;
  a = "parameter";
  return [afterDefine, arguments[0]];
}

function madeAnAccessor(a) {
  Object.defineProperty(arguments, 0, { get: () => "got" });
  a = "parameter";
  return [a, arguments[0], sum(arguments)];
}

function frozen(a, b) {
  Object.freeze(arguments);
  a = "parameter";
  arguments[1] = "stored";
  return [a, b, arguments[0], arguments[1]];
}

function iteratorReplaced(a, b) {
  arguments[Symbol.iterator] = function* () {
    yield "replaced";
  };
  const [first] = arguments;
  return [collect(arguments), [...arguments], first, Array.from(arguments)];
}

function borrowedMethods(a, b, c) {
  const pushed = Array.prototype.push.call(arguments, "pushed");
  const shifted = Array.prototype.shift.call(arguments);
  return [pushed, shifted, a, b, c, collect(arguments)];
}

function sortedInPlace(a, b, c) {
  Array.prototype.sort.call(arguments);
  return [a, b, c];
}

function appliedOnward(a, b) {
  a = "changed";
  return Math.max.apply(null, arguments) + "|" + String.prototype.concat.apply("", arguments);
}

function spreadOnward(a, b) {
  b = 50;
  return Math.max(...arguments);
}

function capturedByAClosure(a) {
  const read = () => arguments[0];
  a = "parameter";
  return read();
}

function withADefault(a, b = 2) {
  a = "parameter";
  return [arguments[0], arguments.length];
}

function withARest(a, ...rest) {
  a = "parameter";
  return [arguments[0], arguments.length, rest];
}

function returned() {
  return arguments;
}

function shadowed(arguments) {
  return sum(arguments);
}

attempt("a parameter is stored, then the arguments are summed", () => parameterStoredThenSummed(1, 2, 3));
attempt("summed in place", () => summedInPlace(1, 2, 3));
attempt("renumbered by a helper", () => renumberedByAHelper(1, 2, 3));
attempt("renumbered in place", () => renumberedInPlace(1, 2, 3));
attempt("fewer arguments than parameters", () => fewerArgumentsThanParameters(1));
attempt("more arguments than parameters", () => moreArgumentsThanParameters(1, 2, 3));
attempt("deleted, then stored", () => deletedThenStored(1, 2));
attempt("the length is stored", () => lengthStored(1, 2, 3));
attempt("the length is grown", () => lengthGrown(1));
attempt("made read-only", () => madeReadOnly(1));
attempt("redefined", () => redefined(1));
attempt("made an accessor", () => madeAnAccessor(1));
attempt("frozen", () => frozen(1, 2));
attempt("the iterator is replaced", () => iteratorReplaced(1, 2));
attempt("borrowed push and shift", () => borrowedMethods(1, 2, 3));
attempt("sorted in place", () => sortedInPlace(3, 1, 2));
attempt("applied onward", () => appliedOnward(1, 2));
attempt("spread onward", () => spreadOnward(1, 2));
attempt("captured by a closure", () => capturedByAClosure(1));
attempt("with a default", () => withADefault(1));
attempt("with a rest", () => withARest(1, 2, 3));
attempt("returned", () => [Array.isArray(returned(1, 2)), Object.prototype.toString.call(returned(1, 2)), returned(1, 2).length, typeof returned().callee]);
attempt("a parameter named arguments", () => shadowed([1, 2, 3]));
attempt("JSON", () => JSON.stringify(returned(1, "two")));
attempt("keys", () => Object.keys(returned(1, "two")));
attempt("given to concat", () => [0].concat(returned(1, 2)).length);
attempt("given to flat", () => [returned(1, 2)].flat().length);
attempt("arrays still work", () => [sum([1, 2, 3]), renumber([1, 2, 3]), collect([1, 2, 3])]);
