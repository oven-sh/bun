function attempt(label, store, use) {
  let answer;
  try {
    store();
    answer = "no error";
  } catch (error) {
    answer = error.constructor.name;
  }
  let result;
  try {
    result = use();
  } catch (error) {
    result = error.constructor.name;
  }
  console.log(label + ": " + answer + ", then " + String(result));
}
attempt("Number.isNaN", () => { Number.isNaN = () => 123; }, () => Number.isNaN(42));
attempt("Number.isInteger", () => { Number.isInteger = () => 123; }, () => Number.isInteger(42));
attempt("Math.abs", () => { Math.abs = () => 123; }, () => Math.abs(-1));
attempt("Math.max", () => { Math.max = () => 123; }, () => Math.max(1, 2));
attempt("Object.keys", () => { Object.keys = () => 123; }, () => Object.keys({ a: 1 }));
attempt("Object.is", () => { Object.is = () => 123; }, () => Object.is(1, 1));
attempt("Array.isArray", () => { Array.isArray = () => 123; }, () => Array.isArray([]));
attempt("Array.from", () => { Array.from = () => 123; }, () => Array.from("ab"));
attempt("String.fromCharCode", () => { String.fromCharCode = () => 123; }, () => String.fromCharCode(65));
attempt("Reflect.ownKeys", () => { Reflect.ownKeys = () => 123; }, () => Reflect.ownKeys({ a: 1 }));
attempt("BigInt.asIntN", () => { BigInt.asIntN = () => 123; }, () => BigInt.asIntN(8, 1n));
attempt("Atomics.add", () => { Atomics.add = () => 123; }, () => Atomics.add(new Int32Array(1), 0, 1));
attempt("ArrayBuffer.isView", () => { ArrayBuffer.isView = () => 123; }, () => ArrayBuffer.isView(1));
attempt("Number.parseFloat", () => { Number.parseFloat = () => 123; }, () => Number.parseFloat("1"));
attempt("JSON.stringify", () => { JSON.stringify = () => 123; }, () => JSON.stringify({}));
attempt("Date.now", () => { Date.now = () => 123; }, () => Date.now());
attempt("Map.groupBy", () => { Map.groupBy = () => 123; }, () => Map.groupBy([], x => x));
attempt("Error.captureStackTrace", () => { Error.captureStackTrace = () => 123; }, () => Error.captureStackTrace({}));
attempt("isNaN", () => { globalThis.isNaN = () => 123; }, () => isNaN(1));
attempt("parseInt", () => { globalThis.parseInt = () => 123; }, () => parseInt("1"));
attempt("Math.random", () => { Math.random = () => 123; }, () => Math.random());
attempt("Math.half", () => { Math.half = () => 123; }, () => Math.half());
attempt("Array.range", () => { Array.range = () => 123; }, () => Array.range());
