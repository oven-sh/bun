// The parameter of a generator function is a pattern, so a call with null throws before there is a generator. The step that is written behind the call never runs.
// Flags: --aot-check=verify-each-pass
function* one({ x }) {
  yield x;
}
function* two({ x, y }) {
  yield [x, y];
}
function* three({ x }) {
  yield x;
}
try {
  one(null).next();
} catch (error) {
  console.log("threw", error.name);
}
try {
  console.log(two(null, 1).next().value);
} catch (error) {
  console.log("threw", error.name);
}
console.log(three({ x: 1 }).next().value);
