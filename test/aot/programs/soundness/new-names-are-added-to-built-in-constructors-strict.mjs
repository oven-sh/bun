function attempt(label, store, read) {
  let answer;
  try {
    store();
    answer = "no error";
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(label + ": " + answer + ", then " + String(read()));
}
attempt("Array.extra", () => { Array.extra = 5; }, () => Array.extra);
attempt("Object.extra", () => { Object.extra = 5; }, () => Object.extra);
attempt("Map.extra", () => { Map.extra = 5; }, () => Map.extra);
attempt("Date.extra", () => { Date.extra = 5; }, () => Date.extra);
attempt("String.extra", () => { String.extra = 5; }, () => String.extra);
attempt("JSON.extra", () => { JSON.extra = 5; }, () => JSON.extra);
attempt("Math.extra", () => { Math.extra = 5; }, () => Math.extra);
attempt("Function.extra", () => { Function.extra = 5; }, () => Function.extra);
attempt("Error.extra", () => { Error.extra = 5; }, () => Error.extra);
