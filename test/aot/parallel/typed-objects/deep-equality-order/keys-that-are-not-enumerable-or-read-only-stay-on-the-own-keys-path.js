// Bun.deepEquals compares an object with a key that is not enumerable, or read-only, as plain Bun does: its own enumerable keys alone, in the order of their creation.
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

const below = (inherited, object) => Object.setPrototypeOf(object, { inherited });
class Marked {
  constructor() {
    Object.defineProperty(this, "mark", { value: true });
    this[first] = leaf("first");
    this.second = leaf("second");
  }
}
const makers = {
  "the exports of a module as a transpiler writes them": inherited => {
    const exports = {};
    Object.defineProperty(exports, "__esModule", { value: true });
    exports[first] = leaf("first");
    exports.third = leaf("third");
    return below(inherited, exports);
  },
  "a hidden name defined last": inherited => {
    const object = { [first]: leaf("first"), fourth: leaf("fourth") };
    return below(inherited, Object.defineProperty(object, "hidden", { value: leaf("hidden") }));
  },
  "a hidden symbol between two names": inherited => {
    const object = { fifth: leaf("fifth") };
    Object.defineProperty(object, first, {
      value: leaf("first"),
      enumerable: false,
      writable: true,
      configurable: true,
    });
    object.sixth = leaf("sixth");
    return below(inherited, object);
  },
  "a name made read-only": inherited => {
    const object = { [first]: leaf("first"), seventh: leaf("seventh") };
    return below(inherited, Object.defineProperty(object, "seventh", { writable: false }));
  },
  "a name made hidden": inherited => {
    const object = { [first]: leaf("first"), eighth: leaf("eighth"), ninth: leaf("ninth") };
    return below(inherited, Object.defineProperty(object, "eighth", { enumerable: false }));
  },
  "an instance whose constructor defines a hidden name": inherited => below(inherited, new Marked()),
  "a frozen literal": inherited => Object.freeze(below(inherited, { [first]: leaf("first"), tenth: leaf("tenth") })),
  "a sealed literal": inherited =>
    Object.seal(below(inherited, { [first]: leaf("first"), eleventh: leaf("eleventh") })),
  "a literal that takes no more keys": inherited =>
    Object.preventExtensions(below(inherited, { [first]: leaf("first"), twelfth: leaf("twelfth") })),
};
for (const [name, make] of Object.entries(makers)) {
  for (const strict of [false, true]) {
    const mode = strict ? ", strict" : "";
    tell(name + mode, () => Bun.deepEquals(make(1), make(1), strict));
    tell(name + ", above them other values" + mode, () => Bun.deepEquals(make(1), make(2), strict));
  }
}
