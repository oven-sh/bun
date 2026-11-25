function* letters() {
  try {
    yield "a";
    yield "b";
  } catch (problem) {
    yield "caught " + problem;
  }
}
async function* relay() {
  yield* letters();
}
const other = relay();
await other.next();
console.log((await other.throw()).value);
const stream = relay();
await stream.next();
try {
  const step = await stream.return(Promise.reject("late"));
  console.log(step.value, step.done);
} catch (problem) {
  console.log("out " + problem);
}
const last = await stream.next();
console.log(last.value, last.done);
