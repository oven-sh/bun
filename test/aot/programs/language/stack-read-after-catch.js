// The stack of an error is captured when the error is created: a catch block that saves the error and reads error.stack one tick later, after every frame has returned, gets the same function names, cut at Error.stackTraceLimit.
function frameNames(error) {
  const names = [];
  for (const line of String(error.stack).split("\n")) {
    const frame = /^\s+at (?:async )?(?:(.*?) \()?/.exec(line) ?? /^(?:async )?(.*?)@/.exec(line);
    // Bun adds an "at <parse>" line to the stack of a SyntaxError. It is not a frame.
    if (frame && frame[1] !== "<parse>") names.push(frame[1] ?? "");
  }
  return names;
}
function inner(kind) {
  if (kind === "native function") return [JSON.parse("{")];
  if (kind === "property of null") return [null.x];
  throw new RangeError("out of range");
}
function middle(kind) {
  return [inner(kind)];
}
async function outer(kind) {
  let caught;
  try {
    middle(kind);
  } catch (error) {
    caught = error;
  }
  await undefined;
  const names = frameNames(caught);
  const end = names.indexOf("outer") + 1;
  console.log(`limit ${Error.stackTraceLimit}, ${kind}: ${caught.name} [${names.slice(0, end || names.length).join(" < ")}]`);
}
for (const limit of [10, 0, 1]) {
  Error.stackTraceLimit = limit;
  for (const kind of ["native function", "property of null", "throw statement"]) await outer(kind);
}
