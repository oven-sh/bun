// Async functions of a library module that take the rest of their arguments are called where the stack has no room for their bodies: the promise is rejected, and the caller goes on in its own frame.
const assert = require("node:assert");
function nothing() {}
let probes = 0;
let strange = 0;

function inASmallFunction() {
  assert.rejects(nothing).then(nothing, nothing);
  return 1;
}

function besideValuesOfTheCaller(one, two) {
  const promise = assert.doesNotReject(nothing, one);
  if (one !== "one" || two !== "two" || !(promise instanceof Promise)) strange++;
  promise.then(nothing, nothing);
}

function inTheCatch(level) {
  try {
    return inTheCatch(level + 1) + 1;
  } catch (error) {
    if (probes++ < 2000)
      try {
        assert.rejects(nothing).then(nothing, nothing);
      } catch {}
    throw error;
  }
}

function throughASmallFunction(level) {
  try {
    return throughASmallFunction(level + 1) + 1;
  } catch (error) {
    if (probes++ < 2000)
      try {
        if (inASmallFunction() !== 1) strange++;
      } catch {}
    throw error;
  }
}

function withValues(level) {
  try {
    return withValues(level + 1) + 1;
  } catch (error) {
    if (probes++ < 2000)
      try {
        besideValuesOfTheCaller("one", "two");
      } catch {}
    throw error;
  }
}

for (const down of [inTheCatch, throughASmallFunction, withValues]) {
  probes = 0;
  try {
    down(0);
  } catch (error) {
    console.log(down.name, error instanceof RangeError);
  }
}
await new Promise(resolve => setTimeout(resolve, 20));
console.log(strange, "end");
