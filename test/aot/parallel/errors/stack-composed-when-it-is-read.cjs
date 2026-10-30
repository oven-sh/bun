// The `stack` of an error is composed when it is read. Nothing else that touches the error calls Error.prepareStackTrace or
// makes a string of the name: the error keeps its frames for the read.
const firstLines = stack =>
  String(stack)
    .split("\n")
    .slice(0, 2)
    .map(line => line.replace(/\(.*[\\/]/, "(").replace(/:\d+:\d+\)?$/, ""))
    .join(" | ");
const read = error => {
  try {
    return firstLines(error.stack);
  } catch (thrown) {
    return `throws ${thrown.constructor.name}`;
  }
};
function make(message) {
  return new Error(message);
}

const touches = {
  nothing: () => {},
  ownNames: error => Object.getOwnPropertyNames(error),
  ownSymbols: error => Object.getOwnPropertySymbols(error),
  ownKeys: error => Reflect.ownKeys(error),
  in: error => "stack" in error,
  hasOwn: error => Object.hasOwn(error, "stack"),
  descriptor: error => Object.getOwnPropertyDescriptor(error, "stack"),
  assign: error => Object.assign({}, error),
  freeze: error => Object.freeze(error),
  line: error => error.line,
};

// With the default formatter: the touch leaves the frames, and the read has them.
for (const [name, touch] of Object.entries(touches)) {
  const error = make(name);
  touch(error);
  console.log(`default ${name}:`, read(error), "|", read(error) === read(error));
}

// With a callback: no call for a touch, one call for the read and none for the next read.
let calls = 0;
Error.prepareStackTrace = (error, callSites) => {
  calls++;
  return `composed for ${error.message} from ${callSites[0].getFunctionName()}`;
};
for (const [name, touch] of Object.entries(touches)) {
  calls = 0;
  const error = make(name);
  touch(error);
  const afterTouch = calls;
  const first = error.stack;
  const second = error.stack;
  console.log(`callback ${name}:`, afterTouch, calls, first, first === second);
}

// A callback that throws: the read throws every time, and the error keeps its frames for the formatter that comes after.
for (const [name, touch] of Object.entries(touches)) {
  calls = 0;
  Error.prepareStackTrace = () => {
    calls++;
    throw new RangeError("callback");
  };
  const error = make(name);
  touch(error);
  const thrown = [read(error), read(error)];
  Error.prepareStackTrace = undefined;
  console.log(`throwing ${name}:`, thrown.join(", "), calls, read(error));
}

// A name that has no string: only the read throws, and it composes the stack once the name has one.
for (const [name, touch] of Object.entries(touches)) {
  const error = make(name);
  error.name = Symbol("name");
  let touched = "returns";
  try {
    touch(error);
  } catch (thrown) {
    touched = `throws ${thrown.constructor.name}`;
  }
  const thrown = [read(error), read(error)];
  if (!Object.isFrozen(error)) error.name = "Named";
  console.log(`symbol ${name}:`, touched, thrown.join(", "), read(error));
}

// An assignment and a delete compose nothing.
calls = 0;
Error.prepareStackTrace = () => {
  calls++;
  return "composed";
};
const assigned = make("assigned");
assigned.stack = "given";
const deleted = make("deleted");
delete deleted.stack;
console.log("assignment:", assigned.stack, "| delete:", "stack" in deleted, deleted.stack, "| calls:", calls);
Error.prepareStackTrace = undefined;
