// Each function object gets a name of its own and is called near the end of the stack, where its call runs out of stack. The error lists many frames and is caught there, time after time, so that collections start where errors are caught.
function make(name) {
  return Object.defineProperty(
    function (work) {
      const result = work();
      return result;
    },
    "name",
    { value: name },
  );
}
function recurse() {
  return recurse() + 1;
}
function value(name) {
  try {
    return make(name)(recurse);
  } catch (error) {
    return error instanceof RangeError;
  }
}
function valueBehindCleanup(name) {
  try {
    try {
      return make(name)(recurse);
    } finally {
      cleanups++;
    }
  } catch (error) {
    return error instanceof RangeError;
  }
}
function thrownOn(name) {
  try {
    try {
      return make(name)(recurse);
    } catch (error) {
      cleanups++;
      throw error;
    }
  } catch {
    return true;
  }
}
function ownError(name) {
  try {
    return make(name)(() => {
      throw new Error(name);
    });
  } catch (error) {
    return error instanceof RangeError || error.message === name;
  }
}
Error.stackTraceLimit = 200;
const ways = [value, valueBehindCleanup, thrownOn, ownError];
let cleanups = 0;
let probes = 0;
let wrong = 0;
function probe(way) {
  for (let at = 0; at < 400; at++) {
    let answer;
    try {
      answer = way("named" + at);
    } catch (error) {
      answer = error instanceof RangeError;
    }
    if (answer !== true) wrong++;
  }
}
function climb(steps, way) {
  const result = steps > 0 ? climb(steps - 1, way) : probe(way);
  return result;
}
function down(level) {
  try {
    return down(level + 1) + 1;
  } catch (error) {
    if (probes < 60) climb(probes % 5, ways[probes++ % ways.length]);
    throw error;
  }
}
try {
  down(0);
} catch (error) {
  console.log(error instanceof RangeError);
}
console.log(probes, wrong, cleanups <= probes * 400);
