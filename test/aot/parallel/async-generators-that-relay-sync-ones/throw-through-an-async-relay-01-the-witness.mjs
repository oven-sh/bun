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
const stream = relay();
await stream.next();
console.log((await stream.throw("late")).value);
