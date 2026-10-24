const lines = [];

function show(value) {
  if (Array.isArray(value) && value.index !== undefined) return value[0] + "@" + value.index;
  return JSON.stringify(value);
}

function attempt(name, run) {
  try {
    lines.push(name + " | " + run());
  } catch (error) {
    lines.push(name + " | THROWS " + error.constructor.name + ": " + error.message);
  }
}

function* numbers() {
  try {
    yield 1;
    yield 2;
    yield 3;
  } finally {
    lines.push("generator finally");
  }
}

const sources = {
  string: () => "a\u{1F600}b\uD83Dc",
  map: () => new Map([["x", 1], ["y", 2], ["z", 3]]),
  "map with number keys": () => new Map([[1, "one"], [2, "two"], [3, "three"]]),
  set: () => new Set(["p", "q", "r"]),
  "set with number keys": () => new Set([1, 2, 3]),
  "map keys": () => new Map([["x", 1], ["y", 2], ["z", 3]]).keys(),
  "map values": () => new Map([["x", 1], ["y", 2], ["z", 3]]).values(),
  "map entries": () => new Map([["x", 1], ["y", 2], ["z", 3]]).entries(),
  "set values": () => new Set(["p", "q", "r"]).values(),
  "set entries": () => new Set(["p", "q", "r"]).entries(),
  "array values": () => [10, 20, 30].values(),
  "array keys": () => [10, 20, 30].keys(),
  "array entries": () => [10, 20, 30].entries(),
  "typed array": () => new Uint8Array([7, 8, 9]),
  generator: () => numbers(),
  matches: () => "aXbX".matchAll(/X/g),
};

function readAll(iterable) {
  const seen = [];
  for (const value of iterable) seen.push(show(value));
  return seen.join(" ");
}

function readFirstThenRest(iterable) {
  const seen = [];
  for (const value of iterable) {
    seen.push(show(value));
    break;
  }
  return seen.join(" ") + " then " + readAll(iterable);
}

function readUntilThrow(iterable) {
  const seen = [];
  try {
    for (const value of iterable) {
      seen.push(show(value));
      throw new RangeError("stop");
    }
  } catch (error) {
    seen.push(error.message);
  }
  return seen.join(" ") + " then " + readAll(iterable);
}

function readPattern(iterable) {
  const [first, second] = iterable;
  return show(first) + " " + show(second) + " then " + readAll(iterable);
}

function readPatternWithRest(iterable) {
  const [first, ...rest] = iterable;
  return show(first) + " " + rest.map(show).join(" ");
}

for (const name of Object.keys(sources)) {
  const create = sources[name];
  attempt(name + ": for..of", () => readAll(create()));
  attempt(name + ": spread", () => [...create()].map(show).join(" "));
  attempt(name + ": pattern", () => readPattern(create()));
  attempt(name + ": pattern with rest", () => readPatternWithRest(create()));
  attempt(name + ": break", () => readFirstThenRest(create()));
  attempt(name + ": throw", () => readUntilThrow(create()));
}

attempt("pairs of map", () => {
  const seen = [];
  for (const [key, value] of sources.map()) seen.push(key + "=" + value);
  return seen.join(" ");
});
attempt("pairs of set entries", () => {
  const seen = [];
  for (const [key, value] of sources["set entries"]()) seen.push(key + "=" + value);
  return seen.join(" ");
});
attempt("pairs of array entries", () => {
  const seen = [];
  for (const [index, value] of sources["array entries"]()) seen.push(index + "=" + value);
  return seen.join(" ");
});

function withOwnReturn(iterator) {
  iterator.return = function () {
    lines.push("own return called");
    return {};
  };
  return iterator;
}

attempt("own return on array iterator", () => readFirstThenRest(withOwnReturn([1, 2, 3].values())));
attempt("own return on map iterator", () => readFirstThenRest(withOwnReturn(new Map([[1, 2], [3, 4]]).keys())));
attempt("own return on set iterator", () => readFirstThenRest(withOwnReturn(new Set([1, 2]).values())));
attempt("own return on matches", () => readFirstThenRest(withOwnReturn("aXbX".matchAll(/X/g))));
attempt("own return on generator", () => readFirstThenRest(withOwnReturn(numbers())));
attempt("own return added in body", () => {
  const iterator = [1, 2, 3].values();
  for (const value of iterator) {
    withOwnReturn(iterator);
    return "left at " + value;
  }
});
attempt("own return not called at end", () => readAll(withOwnReturn([1, 2].values())));

attempt("own next on generator", () => {
  const generator = numbers();
  const next = generator.next;
  generator.next = function (value) {
    lines.push("own next called");
    return next.call(this, value);
  };
  return readAll(generator);
});

function createShrunkView() {
  const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
  const view = new Uint8Array(buffer, 0, 8);
  buffer.resize(4);
  return view;
}

attempt("out-of-bounds view: for..of", () => readAll(createShrunkView()));
attempt("out-of-bounds view: spread", () => [...createShrunkView()].join(" "));
attempt("out-of-bounds view: own iterator", () => {
  const view = createShrunkView();
  view[Symbol.iterator] = function () {
    lines.push("own iterator called");
    return [5][Symbol.iterator]();
  };
  return readAll(view);
});
attempt("view shrunk while iterated", () => {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const view = new Uint8Array(buffer, 0, 4);
  const seen = [];
  for (const value of view) {
    seen.push(value);
    buffer.resize(2);
  }
  return seen.join(" ");
});

const OtherRealmMap = require("node:vm").runInNewContext("Map");
const otherRealmIterator = OtherRealmMap.prototype[Symbol.iterator];
OtherRealmMap.prototype[Symbol.iterator] = function () {
  lines.push("other realm iterator called");
  return otherRealmIterator.call(this);
};
attempt("map of other realm: for..of", () => readAll(new OtherRealmMap([[1, "a"], [2, "b"]])));
attempt("map of other realm: spread", () => [...new OtherRealmMap([[1, "a"]])].map(show).join(" "));
attempt("map of other realm: pattern", () => {
  const [first] = new OtherRealmMap([[1, "a"]]);
  return show(first);
});

console.log(lines.join("\n"));
