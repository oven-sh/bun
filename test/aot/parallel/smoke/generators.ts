// Generators: next, return, throw, delegation and spreads of them.
function* range(from: number, to: number): Generator<number, string, number | undefined> {
  for (let i = from; i < to; i++) {
    const step = yield i;
    if (step !== undefined) i += step;
  }
  return "done";
}
function* both() {
  const result = yield* range(0, 2);
  yield result;
  try {
    yield "inside";
  } finally {
    console.log("closed");
  }
}
console.log([...range(0, 4)]);
const it = range(0, 10);
console.log(it.next(), it.next(3), it.return("early"), it.next());
for (const value of both()) {
  console.log(value);
  if (value === "inside") break;
}
const object = {
  *[Symbol.iterator]() {
    yield 1;
    yield 2;
  },
};
console.log(Math.max(...object));
