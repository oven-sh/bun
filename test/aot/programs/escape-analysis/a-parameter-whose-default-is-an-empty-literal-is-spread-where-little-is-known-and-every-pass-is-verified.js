// A parameter has an empty literal for its default. Behind a test that may end the function early, the function spreads the parameter into a literal between other members.
// What the program works on has been handed once to text that is evaluated at run time, and has come back.
const through = new Function("value", process.argv[9] ?? "return value");
class Span {
  constructor(length) {
    this.length = length;
  }
  get isValid() {
    return this.length === this.length;
  }
  describe(options = {}) {
    if (!this.isValid) return null;
    const length = this.length | 0;
    if (length < 0 || length >= 86400) return null;
    options = {
      short: false,
      prefix: false,
      form: "long",
      ...options,
      offset: false,
    };
    return write(length, options);
  }
}
function write(length, { short, prefix, form, offset, extra }) {
  return `${prefix ? "T" : ""}${form === "long" ? length + " s" : length}${short ? "" : ".000"}${offset ? "Z" : ""}${extra ?? ""}`;
}
class Makers {
  #made = new Map();
  isClosed = false;
  get(nameOrOptions, version, options = {}) {
    if (this.isClosed) return "closed";
    let name, given;
    if (typeof nameOrOptions === "string") {
      name = nameOrOptions;
      given = { version, ...options };
    } else {
      name = nameOrOptions.name;
      given = nameOrOptions;
    }
    const key = `${name}@${given.version || ""}`;
    if (!this.#made.has(key)) this.#made.set(key, { key, address: given?.address || "" });
    return this.#made.get(key);
  }
}
const lines = [];
const given = [undefined, {}, { short: true }, { prefix: true, form: "brief", offset: true }, { extra: "!" }, null];
for (let turn = 0; turn < 60; turn++) {
  const span = through(new (through(Span))([11, -1, 86400, NaN, 3599][turn % 5]));
  const options = through(given[turn % 6]);
  const text = options === undefined ? span.describe() : span.describe(options);
  if (turn < 30) lines.push(String(text));
}
const makers = through(new (through(Makers))());
for (let turn = 0; turn < 40; turn++) {
  const made =
    turn % 4 === 0
      ? makers.get("a", "1")
      : turn % 4 === 1
        ? makers.get("b", "2", { address: "x", version: "3" })
        : turn % 4 === 2
          ? makers.get({ name: "c", address: "y" })
          : makers.get("d");
  if (turn < 4) lines.push(`${made.key} ${made.address}`);
}
makers.isClosed = true;
lines.push(makers.get("e"));
console.log(lines.join("\n"));
