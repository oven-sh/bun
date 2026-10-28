// @bun
// Functions return `new Error()`, `Error()` and `new Function()`, in a file with the first line that `bun build --target=bun` writes. Prints the names and lines of the frames.
function frames(error) {
  const lines = error.stack.split("\n").slice(1, 4);
  return lines.map(line => (/at (\S+) \(/.exec(line)?.[1] ?? "-") + ":" + /:(\d+):\d+\)?$/.exec(line)?.[1]).join(" ");
}
function constructsError() {
  return new Error("a");
}
function constructsTypeError() {
  return new TypeError("b");
}
function constructsWithoutArguments() {
  return new RangeError();
}
function callsError() {
  return Error("c");
}
function constructsAggregate() {
  return new AggregateError([], "d");
}
const arrow = () => new SyntaxError("e");
class Holder {
  method() {
    return new EvalError("f");
  }
  static make() {
    return new URIError("g");
  }
}
function constructsFunction() {
  return new Function("return new Error('h')");
}
console.log(frames(constructsError()));
console.log(frames(constructsTypeError()));
console.log(frames(constructsWithoutArguments()));
console.log(frames(callsError()));
console.log(frames(constructsAggregate()));
console.log(frames(arrow()));
console.log(frames(new Holder().method()));
console.log(frames(Holder.make()));
console.log(typeof constructsFunction());
