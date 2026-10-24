// The body of a module with top-level await runs in a resumed coroutine. Its frames are still module code.
function framesOf(error) {
  return error.stack
    .split("\n")
    .filter(line => line.includes("stack-frames-top-level-await"))
    .map(line => line.trim().replace(/\(.*[\\/]/, "(").replace(/at .*[\\/]/, "at "))
    .join(" | ");
}

// The error is used twice: plain Bun's transpiler writes `return new Error(..)` as `return Error(..)`, a tail call, which drops this frame.
const created = [];
function createError() {
  const error = new Error("callee");
  created.push(error);
  return error;
}

console.log("before the first await:", framesOf(new Error("before")));
console.log("callee before the first await:", framesOf(createError()));

await 0;
console.log("after an await:", framesOf(new Error("after")));
console.log("callee after an await:", framesOf(createError()));

async function throwsAfterAwait() {
  await null;
  throw new Error("async");
}

try {
  await throwsAfterAwait();
} catch (error) {
  console.log("awaited by the module:", framesOf(error));
}
