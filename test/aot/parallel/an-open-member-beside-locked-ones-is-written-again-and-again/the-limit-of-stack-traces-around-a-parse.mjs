// Many packages set Error.stackTraceLimit to 0 around a parse and put it back. Error.captureStackTrace is called too, so the build locks it and Error has a list of fixed names:
// every store to the member that stays open goes past that list. What is stored is read back each time, by the program and by the engine.
function parse(text) {
  const { stackTraceLimit } = Error;
  Error.stackTraceLimit = 0;
  try {
    return [JSON.parse(text), Error.stackTraceLimit, String(new Error("none").stack).split("\n").length];
  } finally {
    Error.stackTraceLimit = stackTraceLimit;
  }
}
function deep(depth) {
  return depth ? deep(depth - 1) : String(new Error("some").stack).split("\n").length;
}
const holder = {};
Error.captureStackTrace(holder);
console.log(typeof holder.stack, Error.stackTraceLimit);
for (let turn = 0; turn < 4; turn++) {
  const [value, inside, lines] = parse('{"turn":' + turn + "}");
  Error.stackTraceLimit = turn + 1;
  console.log(value.turn, inside, lines, Error.stackTraceLimit, deep(8));
  Error.stackTraceLimit = 10;
}
console.log(delete Error.stackTraceLimit, "stackTraceLimit" in Error, Error.stackTraceLimit);
Error.stackTraceLimit = 3;
console.log(Object.getOwnPropertyDescriptor(Error, "stackTraceLimit"), deep(8));
Object.defineProperty(Error, "stackTraceLimit", { value: 2, writable: true, configurable: true, enumerable: true });
console.log(Error.stackTraceLimit, deep(8));
Error.ownName = 1;
Error.ownName = 2;
console.log(Error.ownName, delete Error.ownName, Error.ownName);
