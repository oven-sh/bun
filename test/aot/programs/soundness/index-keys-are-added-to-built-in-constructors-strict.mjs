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
attempt("Array[1]", () => { Array[1] = 5; }, () => Array[1]);
attempt("Object[1]", () => { Object[1] = 5; }, () => Object[1]);
attempt("Map[1]", () => { Map[1] = 5; }, () => Map[1]);
attempt("Date[1]", () => { Date[1] = 5; }, () => Date[1]);
attempt("String[1]", () => { String[1] = 5; }, () => String[1]);
attempt("JSON[1]", () => { JSON[1] = 5; }, () => JSON[1]);
attempt("Function[1]", () => { Function[1] = 5; }, () => Function[1]);
attempt("Error[1]", () => { Error[1] = 5; }, () => Error[1]);
const holder = Array;
const key = [3][0];
attempt("Array by a variable", () => { holder[key] = 5; }, () => holder[key]);
