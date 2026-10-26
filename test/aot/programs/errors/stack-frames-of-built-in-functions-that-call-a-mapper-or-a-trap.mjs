// A mapper, or a trap of a proxy, takes a stack trace or throws. Each row prints the frames between it and the function `start`: their names,
// and for a built-in function what stands in the place of its file.
const framesOf = stack => {
  const frames = String(stack)
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, ""))
    .map(frame =>
      frame.includes(" (") ? frame.replace(/\((native|unknown)?.*\)/, (place, word = "file") => `(${word})`) : "(file)",
    );
  const end = frames.findIndex(frame => frame.startsWith("start "));
  return frames.slice(0, end + 1).join(" < ");
};
let seen = "";
function look() {
  seen = framesOf(new Error().stack);
  return 1;
}
function fail() {
  throw new RangeError("thrown by the callback");
}
function start(run) {
  seen = "";
  try {
    const result = run();
    return seen + " | " + JSON.stringify(result);
  } catch (error) {
    const message = error.message.replace(/ \(evaluating '.*'\)$/s, "").replace(/\. \(In '.*\)$/s, "");
    return error.name + ": " + message + " | " + framesOf(error.stack);
  }
}
const listed = trap => new Proxy({ a: 1 }, { ownKeys: () => (trap(), ["a"]) });
const described = trap =>
  new Proxy(
    { a: 1 },
    { getOwnPropertyDescriptor: (target, key) => (trap(), Reflect.getOwnPropertyDescriptor(target, key)) },
  );
const anyLength = [2, 0, -1, 1.5, "2", null, undefined, { valueOf: look }, { valueOf: fail }];

const rows = {
  fromLength: callback => Array.from({ length: 2 }, callback),
  fromLengthWritten: callback => Array.from({ length: 2 }, (value, index) => callback(value, index)),
  fromLengthReturned(callback) {
    return Array.from({ length: 1 }, callback);
  },
  fromList: callback => Array.from([1], callback),
  fromSet: callback => Array.from(new Set([1]), callback),
  flatMap: callback => [1].flatMap(callback),
  flatMapOfHoles: callback => [, 1].flatMap(callback),
  flatMapOfObject: callback => Array.prototype.flatMap.call({ length: 1, 0: 1 }, callback),
  flat: callback =>
    [
      [1],
      {
        get length() {
          return callback();
        },
      },
    ].flat(),
  map: callback => [1].map(callback),
  keys: callback => Object.keys(listed(callback)),
  keysDescribed: callback => Object.keys(described(callback)),
  names: callback => Object.getOwnPropertyNames(listed(callback)),
  symbols: callback => Object.getOwnPropertySymbols(listed(callback)),
  ownKeys: callback => Reflect.ownKeys(listed(callback)),
  entries: callback => Object.entries(listed(callback)),
  values: callback => Object.values(listed(callback)),
  entriesOfGetter: callback =>
    Object.entries({
      get a() {
        return callback();
      },
    }),
  valuesOfGetter: callback =>
    Object.values({
      get a() {
        return callback();
      },
    }),
  assign: callback => Object.assign({}, listed(callback)),
  spread: callback => ({ ...listed(callback) }),
  forIn(callback) {
    const found = [];
    for (const key in listed(callback)) found.push(key);
    return found;
  },
};
for (const [name, run] of Object.entries(rows)) {
  console.log(
    name,
    "looks:",
    start(() => run(look)),
  );
  console.log(
    name,
    "throws:",
    start(() => run(fail)),
  );
  console.log(
    name,
    "no function:",
    start(() => run(1)),
  );
}
for (const length of anyLength)
  console.log(
    "a length of",
    String(JSON.stringify(length)),
    start(() => Array.from({ length }, look)),
  );
for (const value of [null, undefined, 1, "ab", Symbol.iterator]) {
  console.log(
    "keys of",
    String(value),
    start(() => Object.keys(value)),
  );
  console.log(
    "names of",
    String(value),
    start(() => Object.getOwnPropertyNames(value)),
  );
  console.log(
    "symbols of",
    String(value),
    start(() => Object.getOwnPropertySymbols(value)),
  );
  console.log(
    "own keys of",
    String(value),
    start(() => Reflect.ownKeys(value)),
  );
}
