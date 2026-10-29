// Each line spreads a text of 268,435,457 characters, one more than a list holds, and prints what is thrown.
const long = "a".repeat(268435457);
function take() {
  return arguments.length;
}
class Taker {
  constructor() {
    this.count = arguments.length;
  }
}
function attempt(name, run) {
  try {
    console.log(name, run(long));
  } catch (error) {
    console.log(name, error.constructor.name + ": " + error.message);
  }
}
attempt("call", () => take(...long));
attempt("call of a parameter", text => take(...text));
attempt("new", text => new Taker(...text).count);
attempt("literal", () => [...long].length);
attempt("literal of a parameter", text => [...text].length);
attempt("behind an element", text => [0, ...text].length);
attempt("a part that fits", text => [...text.slice(0, 4)].length);
