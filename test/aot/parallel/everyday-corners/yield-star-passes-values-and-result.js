// Yield star passes values and result: compiled answers as plain.
function* inner() {
  const x = yield 1;
  return x * 2;
}
function* outer() {
  const r = yield* inner();
  yield r;
}
const it = outer();
console.log(it.next().value, it.next(21).value, it.next().done);
