// `for (const x of r.entries())` with the call on another line than `for`: a stack trace taken in the method, in a getter of the method, or by "r.entries is not a function" names the line of the call.
function frameOf(stack, name) {
  const line = stack.split("\n").find(line => line.includes("at " + name + " "));
  return line ? line.trim().replace(/[^\s(]*[\\/]/, "") : "no frame of " + name;
}

function iterateEntries(r) {
  let count = 0;
  for (const x of
      r.entries()) count++;
  return count;
}
function iterateValues(r) {
  let count = 0;
  for (const x of
      r
        .values()) count++;
  return count;
}

function attempt(label, loop, receiver) {
  try {
    console.log(label + ": returned " + loop(receiver));
  } catch (error) {
    console.log(label + ": " + error.constructor.name + ": " + frameOf(error.stack, loop.name));
  }
}

for (const loop of [iterateEntries, iterateValues]) {
  const withMethod = method => ({ entries: method, values: method });
  const withGetter = getter => Object.defineProperties({}, { entries: { get: getter }, values: { get: getter } });
  attempt("map", loop, new Map([[1, 2]]));
  attempt("array", loop, [1, 2, 3]);
  attempt("method takes a trace", loop, withMethod(() => {
    console.log("in the method: " + frameOf(new Error().stack, loop.name));
    return [].values();
  }));
  attempt("method throws", loop, withMethod(() => { throw new Error("method"); }));
  attempt("getter throws", loop, withGetter(() => { throw new Error("getter"); }));
  attempt("no method", loop, {});
  attempt("method is a number", loop, withMethod(5));
}
