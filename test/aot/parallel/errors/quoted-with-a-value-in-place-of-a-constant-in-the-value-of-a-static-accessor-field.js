// The value of a `static accessor #x` field calls a constant that is no function: the message quotes the call with the value in place of the name, as Bun's transpiler prints it.
const notFunction = 5;
try {
  class Gauge {
    static accessor #level = notFunction();
  }
  console.log("no error");
} catch (error) {
  console.log(error.message);
}
