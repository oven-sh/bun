// Error.captureStackTrace under an Error.stackTraceLimit that allows no frames. A number below 1 and NaN leave the message line. A limit that is no number leaves `stack` undefined. The targets are a plain object, an Error, an Error whose stack was read, an Error of a class that captures in its constructor, and a plain object with the function to leave out.
const show = target =>
  typeof target.stack === "string"
    ? target.stack
        .split("\n")
        .map(line =>
          line
            .trim()
            .replace(/ ?\(.*\)$/, "")
            .replace(/^at \S*[\\/].*$/, "at module"),
        )
        .join(" < ")
    : `${Object.hasOwn(target, "stack") ? "own" : "no own"} ${target.stack}`;
class Failure extends Error {
  constructor(message) {
    super(message);
    Error.captureStackTrace(this, Failure);
  }
}
function capture(setLimit) {
  const made = new Error("made");
  const read = new Error("read");
  const readBefore = show(read);
  const plain = {};
  const below = {};
  setLimit();
  Error.captureStackTrace(plain);
  Error.captureStackTrace(made);
  Error.captureStackTrace(read);
  const failure = new Failure("failure");
  (function leftOut() {
    Error.captureStackTrace(below, leftOut);
  })();
  Error.stackTraceLimit = 10;
  return [readBefore.includes("at capture"), ...[plain, made, read, failure, below].map(show)].join(" | ");
}
function outer(setLimit) {
  // No tail call: the frame stays on the stack.
  try {
    return capture(setLimit);
  } finally {
  }
}
const limits = {
  "2": () => (Error.stackTraceLimit = 2),
  "0": () => (Error.stackTraceLimit = 0),
  "-1": () => (Error.stackTraceLimit = -1),
  "0.5": () => (Error.stackTraceLimit = 0.5),
  "NaN": () => (Error.stackTraceLimit = NaN),
  '"0"': () => (Error.stackTraceLimit = "0"),
  "null": () => (Error.stackTraceLimit = null),
  "undefined": () => (Error.stackTraceLimit = undefined),
  "deleted": () => delete Error.stackTraceLimit,
};
for (const name in limits) console.log(name + ":", outer(limits[name]));
