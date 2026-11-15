function* letters() {
  yield "a";
  yield "b";
}
async function* relay() {
  yield* letters();
}
const stream = relay();
await stream.next();
try {
  await stream.throw("late");
} catch (problem) {
  console.log("out " + problem, (await stream.next()).done);
}
