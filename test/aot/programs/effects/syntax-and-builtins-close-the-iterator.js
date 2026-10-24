// A loop that is left early, a pattern that takes fewer values than there are and a built-in that fails in the middle of an iterable call `return` of the iterator: each line goes wrong if a read of a counter moves across that call.
let steps = 0;
let closes = 0;
const iterable = {
  [Symbol.iterator]() {
    return {
      next() {
        steps++;
        return { done: steps > 3, value: [steps, steps] };
      },
      return() {
        closes++;
        return {};
      },
    };
  },
};
function leaveLoop() {
  steps = 0;
  closes = 0;
  for (const value of iterable) {
    if (value[0] === 2) break;
  }
  return [steps, closes];
}
function pattern() {
  steps = 0;
  closes = 0;
  const [first] = iterable;
  return [first[0], steps, closes];
}
function spread() {
  steps = 0;
  closes = 0;
  const values = [...iterable];
  return [values.length, steps, closes];
}
function arrayFrom() {
  steps = 0;
  closes = 0;
  let failed = false;
  try {
    Array.from(iterable, value => {
      if (value[0] === 2) throw new Error("stop");
      return value;
    });
  } catch {
    failed = true;
  }
  return [failed, steps, closes];
}
function collections() {
  steps = 0;
  closes = 0;
  const map = new Map(iterable);
  const afterMap = steps;
  steps = 0;
  const set = new Set(iterable);
  return [map.size, afterMap, set.size, steps, closes];
}
function fromEntries() {
  steps = 0;
  const object = Object.fromEntries(iterable);
  return [Object.keys(object).length, steps];
}
function* delegate() {
  yield* iterable;
}
function closeDelegate() {
  const generator = delegate();
  steps = 0;
  closes = 0;
  generator.next();
  const afterStep = steps;
  generator.return();
  return [afterStep, closes];
}
console.log(leaveLoop(), pattern(), spread());
console.log(arrayFrom(), collections(), fromEntries(), closeDelegate());
