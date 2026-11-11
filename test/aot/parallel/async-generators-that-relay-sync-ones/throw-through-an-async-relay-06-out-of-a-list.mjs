function* letters() {
  try {
    yield "a";
  } catch (problem) {
    yield "caught " + problem;
  }
}
async function* relay(l) {
  yield* l[0];
}
const stream = relay([letters()]);
await stream.next();
console.log((await stream.throw("late")).value);
