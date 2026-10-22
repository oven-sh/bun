class Shelf {
  get 1() {
    return "getter";
  }
  2() {
    return "method";
  }
  ["3"]() {
    return "method under a text";
  }
  static 4() {
    return "static method";
  }
  set 5(value) {
    this.stored = value;
  }
}
function attempt(label, use) {
  try {
    console.log(label, use());
  } catch (error) {
    console.log(label, error.constructor.name);
  }
}
const shelf = new Shelf();
const keys = [1, 2, 3, 4, 5];
attempt("getter", () => shelf[1]);
attempt("getter by a text", () => shelf["1"]);
attempt("getter by a variable", () => shelf[keys[0]]);
attempt("method", () => shelf[2]());
attempt("method by a variable", () => shelf[keys[1]]());
attempt("method under a text", () => shelf[3]());
attempt("static method", () => Shelf[4]());
attempt("setter", () => ((shelf[5] = "kept"), shelf.stored));
