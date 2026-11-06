// The value of a `static accessor #x` field constructs what is no constructor, with an argument that Bun's transpiler folds: the message quotes `(3)`.
function declare(notConstructor) {
  class Gauge {
    static accessor #level = new notConstructor(1 + 2);
  }
  return Gauge;
}
try {
  declare(5);
  console.log("no error");
} catch (error) {
  console.log(error.message);
}
