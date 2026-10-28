// A built-in that keeps its operand walks a generator. In code that never runs it is given a proxy. Nothing in the program names `next`.
function* one() {
  yield 1;
}
if (process.argv.length > 9) new AggregateError(new Proxy([], {}));
console.log(new AggregateError(one()).errors);
