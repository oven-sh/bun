// The value of a `static accessor #x` field calls what is no function, with arguments that Bun's transpiler folds: the message quotes `(3, "ab")`.
function declare(notFunction) {
  class Gauge {
    static accessor #level = notFunction(1 + 2, "a" + "b");
  }
  return Gauge;
}
try {
  declare(5);
  console.log("no error");
} catch (error) {
  console.log(error.message);
}
