// An error created at the throw: caught with and without a binding, and rejected from an async function.
function describeError(error) {
  const firstLine = error.stack.split("\n")[0];
  return [error.constructor.name, error.message, firstLine].join(" | ");
}

function throwRange() {
  throw new RangeError("x");
}
function throwType() {
  throw new TypeError("y");
}

function ignoresValue() {
  try {
    throwRange();
  } catch {
    return "caught without binding";
  }
  return "not caught";
}
console.log(ignoresValue());

function ignoresValueInSameFunction() {
  try {
    throw new RangeError("x");
  } catch {
    return "caught here without binding";
  }
}
console.log(ignoresValueInSameFunction());

function readsValue(thrower) {
  try {
    thrower();
  } catch (error) {
    return describeError(error);
  }
  return "not caught";
}
console.log(readsValue(throwRange));
console.log(readsValue(throwType));

function readsValueInSameFunction() {
  try {
    throw new RangeError("x");
  } catch (error) {
    return describeError(error);
  }
}
console.log(readsValueInSameFunction());

function throwsPrimitive(value) {
  try {
    throw value;
  } catch (error) {
    return error;
  }
}
console.log(throwsPrimitive(5));
console.log(throwsPrimitive(undefined));

function throwsFiveWithoutBinding() {
  try {
    throw 5;
  } catch {
    return "five ignored";
  }
}
console.log(throwsFiveWithoutBinding());

function throwsUndefinedThroughCall() {
  const thrower = () => {
    throw undefined;
  };
  try {
    thrower();
  } catch (error) {
    return error === undefined;
  }
  return "not caught";
}
console.log(throwsUndefinedThroughCall());

async function rejects() {
  throw new RangeError("x");
}
rejects().catch(error => console.log("rejected:", describeError(error)));

async function rejectsAfterAwait() {
  await null;
  throw new RangeError("after await");
}
rejectsAfterAwait().catch(error => console.log("rejected:", describeError(error)));

async function rejectsWithPrimitive() {
  throw 5;
}
rejectsWithPrimitive().catch(error => console.log("rejected:", error));
