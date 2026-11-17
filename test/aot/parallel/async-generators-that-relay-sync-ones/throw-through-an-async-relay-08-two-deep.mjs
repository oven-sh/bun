function* letters() {
  try {
    yield "a";
  } catch (problem) {
    yield "caught " + problem;
  }
}
async function* relay() {
  yield* letters();
}
async function* outer() {
  yield* relay();
}
const stream = outer();
await stream.next();
console.log((await stream.throw("late")).value);
