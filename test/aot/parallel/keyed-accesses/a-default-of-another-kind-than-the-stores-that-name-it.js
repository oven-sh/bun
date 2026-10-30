// acorn's `ecmaVersion: "latest"`: the loop over the defaults stores a text under a name that every store by name gives a number.
const nothing = String(Date.now()).slice(99);
const hand = new Function("value", "return value" + nothing);
const defaults = { version: null, strict: false, limit: 10, label: "none" };
function getOptions(given) {
  const options = {};
  for (const name in defaults) options[name] = given && Object.hasOwn(given, name) ? given[name] : defaults[name];
  if (options.version === "latest") options.version = 1e8;
  else if (options.version == null) options.version = 11;
  else if (options.version >= 2015) options.version -= 2009;
  if (options.strict == null) options.strict = options.version < 5;
  options.limit = options.limit | 0;
  return options;
}
class Reader {
  constructor(given) {
    this.options = hand(getOptions(given));
    this.count = 0;
  }
  step() {
    if (this.options.strict) this.count += 2;
    if (this.options.version >= 6) this.count += 1;
    return this.count + this.options.limit;
  }
}
for (const given of [
  { version: "latest" },
  { version: 2020 },
  undefined,
  { version: 3, strict: null },
  { version: "latest", limit: "7", strict: "yes" },
  { limit: 2.5, label: 5 },
]) {
  const reader = new Reader(given);
  let sum = 0;
  for (let i = 0; i < 200; i++) sum += reader.step();
  console.log(sum, Object.keys(reader.options).join(), JSON.stringify(reader.options));
}
