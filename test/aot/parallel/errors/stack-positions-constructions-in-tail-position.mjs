// Where a stack trace shows a function that ends by constructing a built-in. Bun's transpiler prints `new Error()` as a call, but not in tail position, whether or not a call there would be a tail call.
const positionsOf = error => String(error.stack).split("\n").slice(1, 3).map(line => line.replace(/^.*:(\d+:\d+)\)?$/, "$1")).join(" ");
async function show(run) {
  let error;
  try {
    error = await run(1);
  } catch (thrown) {
    error = thrown;
  }
  console.log(run.name, error.constructor.name, positionsOf(error));
}
const arrow = n => new Error(n);
await show(function withAnArgument(n) { return new Error(n); });
await show(function withoutArguments() { return new Error(); });
await show(function inAConditional(n) { return n ? new TypeError(n) : new RangeError(n); });
await show(function inTheOtherBranch(n) { return !n ? new TypeError(n) : new RangeError(n); });
await show(function behindALogicalOperator(n) { return !n || new Error(n); });
await show(function behindAComma(n) { return n, new Error(n); });
await show(function insideTry(n) { try { return new Error(n); } catch {} });
await show(function insideFinally(n) { try {} finally { return new Error(n); } });
await show(async function inAnAsyncFunction(n) { return new Error(n); });
await show(function inAGenerator(n) { return (function* () { return new Error(n); })().next().value; });
await show(arrow);
await show(function textThatDoesNotParse() { return new Function("}"); });
await show(function errorsThatAreNoList(n) { return new AggregateError(n); });
await show(function aLengthThatIsNone() { return new Array(-1); });
await show(function aLengthThatIsNoneInASpread() { return new Array(...[-1]); });
await show(function heldByAVariable(n) { const error = new Error(n); return error; });
await show(function heldByAVariableWithoutArguments() { const error = new Error(); return error; });
await show(function readFrom(n) { return new Error(n).cause ?? new Error(n); });
await show(function inAList(n) { return [new Error(n)].pop(); });
await show(function thrown(n) { throw new Error(n); });
