const own = { [Symbol.iterator]() { return this; }, next() { return { value: "a", done: false }; }, throw(problem) { return { value: "own " + problem, done: false }; } };
async function* relay() {
  yield* own;
}
const stream = relay();
await stream.next();
console.log((await stream.throw("late")).value);
