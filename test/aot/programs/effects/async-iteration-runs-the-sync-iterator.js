// `for await` over an iterable that is not async, and `yield*` in an async generator, step and close the underlying iterator through %AsyncFromSyncIteratorPrototype%: each line goes wrong if a read of a counter moves across an await.
let steps = 0;
let closes = 0;
const iterable = {
  [Symbol.iterator]() {
    return {
      next() {
        steps++;
        return { done: steps > 3, value: steps };
      },
      return() {
        closes++;
        return {};
      },
    };
  },
};
async function leaveLoop() {
  steps = 0;
  closes = 0;
  for await (const value of iterable) {
    if (value === 2) break;
  }
  return [steps, closes];
}
async function finishLoop() {
  steps = 0;
  closes = 0;
  let sum = 0;
  for await (const value of iterable) sum += value;
  return [sum, steps, closes];
}
async function* delegate() {
  yield* iterable;
}
async function closeDelegate() {
  const generator = delegate();
  steps = 0;
  closes = 0;
  await generator.next();
  const afterStep = steps;
  await generator.return();
  return [afterStep, closes];
}
async function fromAsync() {
  steps = 0;
  const values = await Array.fromAsync(iterable);
  return [values.length, steps];
}
console.log(await leaveLoop(), await finishLoop(), await closeDelegate(), await fromAsync());
