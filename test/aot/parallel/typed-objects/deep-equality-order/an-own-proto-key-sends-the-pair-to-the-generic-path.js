// Bun.deepEquals compares an object that has an own key "__proto__" as plain Bun does: names before symbols, and the enumerable keys that it inherits too.
const first = Symbol("first");
const log = [];
const leaf = name => ({
  get read() {
    log.push(name);
    return 1;
  },
});
function tell(label, run) {
  log.length = 0;
  console.log(label + ": " + run() + " | " + log.join(" "));
}

const above = inherited => ({ inherited });
function written(inherited) {
  const object = { [first]: leaf("first"), ["__proto__"]: 1, second: leaf("second") };
  return Object.setPrototypeOf(object, above(inherited));
}
function hidden(inherited) {
  const object = { [first]: leaf("first"), second: leaf("second") };
  Object.defineProperty(object, "__proto__", { value: 1, enumerable: false, writable: true, configurable: true });
  return Object.setPrototypeOf(object, above(inherited));
}
const bare = inherited => Object.setPrototypeOf({ [first]: leaf("first"), second: leaf("second") }, above(inherited));
function named(inherited) {
  const object = { third: leaf("third"), ["__proto__"]: 1, fourth: leaf("fourth") };
  return Object.setPrototypeOf(object, above(inherited));
}

for (const strict of [false, true]) {
  const mode = strict ? ", strict" : "";
  tell("the key in both" + mode, () => Bun.deepEquals(written(1), written(1), strict));
  tell("the key in both, above them other values" + mode, () => Bun.deepEquals(written(1), written(2), strict));
  tell("the key in both, not enumerable" + mode, () => Bun.deepEquals(hidden(1), hidden(1), strict));
  tell("the key in both, not enumerable, above them other values" + mode, () =>
    Bun.deepEquals(hidden(1), hidden(2), strict),
  );
  tell("the key in the first only, not enumerable, above them other values" + mode, () =>
    Bun.deepEquals(hidden(1), bare(2), strict),
  );
  tell("the key in the second only, not enumerable, above them other values" + mode, () =>
    Bun.deepEquals(bare(1), hidden(2), strict),
  );
  tell("the key in neither, above them other values" + mode, () => Bun.deepEquals(bare(1), bare(2), strict));
  tell("the key between two names" + mode, () => Bun.deepEquals(named(1), named(1), strict));
  tell("the key between two names, above them other values" + mode, () => Bun.deepEquals(named(1), named(2), strict));
}
