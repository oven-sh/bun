function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value !== "object" || value === null) return String(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + describe(value[key]));
  return (Array.isArray(value) ? "[" : "{") + parts.join(", ") + (Array.isArray(value) ? "]" : "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

class Loud extends Array {
  push() {
    return "the subclass's push";
  }
  map() {
    return "the subclass's map";
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const impostors = {
  "an array-like": () => ({ 0: 7, 1: 8, length: 2 }),
  "a subclass": () => Loud.of(7, 8),
  "a string": () => "78",
  "a typed array": () => new Uint8Array([200, 100]),
  "null": () => null,
};

function run(callee, value) {
  return callee(value);
}

function useByEval(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useByIndirectEval(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useByNewFunction(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useWithAValueFromEval(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

attempt("eval, honest site 1", () => useByEval([1, 2, 3]));
attempt("eval, honest site 2", () => useByEval([4, 5]));
attempt("eval, honest site 3", () => useByEval([]));
for (let i = 0; i < 300; i++) useByEval([i, i]);
for (const name in impostors) attempt("eval, " + name, () => (value => eval("useByEval")(value))(impostors[name]()));
attempt("eval, an array by the same route", () => (value => eval("useByEval")(value))([1, 2, 3]));
attempt("eval, honest site 4", () => useByEval([6, 7, 8]));

attempt("a caller made by indirect eval, honest site 1", () => useByIndirectEval([1, 2, 3]));
attempt("a caller made by indirect eval, honest site 2", () => useByIndirectEval([4, 5]));
attempt("a caller made by indirect eval, honest site 3", () => useByIndirectEval([]));
for (let i = 0; i < 300; i++) useByIndirectEval([i, i]);
for (const name in impostors) attempt("a caller made by indirect eval, " + name, () => (value => (0, eval)("(callee, value) => callee(value)")(useByIndirectEval, value))(impostors[name]()));
attempt("a caller made by indirect eval, an array by the same route", () => (value => (0, eval)("(callee, value) => callee(value)")(useByIndirectEval, value))([1, 2, 3]));
attempt("a caller made by indirect eval, honest site 4", () => useByIndirectEval([6, 7, 8]));

attempt("a caller made by new Function, honest site 1", () => useByNewFunction([1, 2, 3]));
attempt("a caller made by new Function, honest site 2", () => useByNewFunction([4, 5]));
attempt("a caller made by new Function, honest site 3", () => useByNewFunction([]));
for (let i = 0; i < 300; i++) useByNewFunction([i, i]);
for (const name in impostors) attempt("a caller made by new Function, " + name, () => (value => new Function("callee", "value", "return callee(value);")(useByNewFunction, value))(impostors[name]()));
attempt("a caller made by new Function, an array by the same route", () => (value => new Function("callee", "value", "return callee(value);")(useByNewFunction, value))([1, 2, 3]));
attempt("a caller made by new Function, honest site 4", () => useByNewFunction([6, 7, 8]));

attempt("a plain call with a value from eval, honest site 1", () => useWithAValueFromEval([1, 2, 3]));
attempt("a plain call with a value from eval, honest site 2", () => useWithAValueFromEval([4, 5]));
attempt("a plain call with a value from eval, honest site 3", () => useWithAValueFromEval([]));
for (let i = 0; i < 300; i++) useWithAValueFromEval([i, i]);
for (const name in impostors) attempt("a plain call with a value from eval, " + name, () => (value => useWithAValueFromEval((0, eval)("(" + JSON.stringify(typeof value === "string" ? value : value && { ...value, length: value.length }) + ")")))(impostors[name]()));
attempt("a plain call with a value from eval, an array by the same route", () => (value => useWithAValueFromEval((0, eval)("(" + JSON.stringify(typeof value === "string" ? value : value && { ...value, length: value.length }) + ")")))([1, 2, 3]));
attempt("a plain call with a value from eval, honest site 4", () => useWithAValueFromEval([6, 7, 8]));
