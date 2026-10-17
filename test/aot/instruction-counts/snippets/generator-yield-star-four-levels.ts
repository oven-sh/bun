// resumes a generator that delegates through four levels of yield*
function* naturals(): Generator<number, void, void> {
  for (let n = 0; ; n++) yield n;
}
function* first(): Generator<number, void, void> {
  yield* naturals();
}
function* second(): Generator<number, void, void> {
  yield* first();
}
function* third(): Generator<number, void, void> {
  yield* second();
}
function* fourth(): Generator<number, void, void> {
  yield* third();
}
const operations = 100;
const numbers = fourth();
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const result = numbers.next();
    if (result.done) break;
    total += result.value;
  }
}

console.log(total);
