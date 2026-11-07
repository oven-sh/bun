// Where a stack trace shows a sloppy function that ends by constructing a built-in. It makes no tail call, and Bun's transpiler leaves the `new` in tail position all the same.
const positionsOf = error => String(error.stack).split("\n").slice(1, 3).map(line => line.replace(/^.*:(\d+:\d+)\)?$/, "$1")).join(" ");
function show(run) {
  let error;
  try {
    error = run(1);
  } catch (thrown) {
    error = thrown;
  }
  console.log(run.name, error.constructor.name, positionsOf(error));
}
const arrow = n => new Error(n);
show(function withAnArgument(n) { return new Error(n); });
show(function withoutArguments() { return new Error(); });
show(function inAConditional(n) { return n ? new TypeError(n) : new RangeError(n); });
show(function behindALogicalOperator(n) { return !n || new Error(n); });
show(function insideTry(n) { try { return new Error(n); } catch {} });
show(arrow);
show(function textThatDoesNotParse() { return new Function("}"); });
show(function errorsThatAreNoList(n) { return new AggregateError(n); });
show(function aLengthThatIsNone() { return new Array(-1); });
show(function heldByAVariable(n) { const error = new Error(n); return error; });
show(function thrown(n) { throw new Error(n); });
