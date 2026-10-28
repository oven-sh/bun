function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

function read(object, first, second) {
  return object[first + second];
}

function has(object, first, second) {
  return [first + second in object, Object.hasOwn(object, first + second)];
}

function call(object, first, second, ...given) {
  return object[first + second](...given);
}

function kind(value) {
  return typeof value === "function" ? "function of " + value.length : typeof value === "symbol" ? "symbol" : typeof value === "object" && value !== null ? "object" : show(value);
}

for (let i = 0; i < 2000; i++) {
  read({ name: 1 }, "na", "me");
  has({ name: 1 }, "na", "me");
  call({ name: () => 1 }, "na", "me");
}

const rows = [
  ["Math", Math, "fro", "und"],
  ["Math", Math, "cl", "z32"],
  ["Math", Math, "hyp", "ot"],
  ["Math", Math, "SQRT", "1_2"],
  ["Math", Math, "exp", "m1"],
  ["JSON", JSON, "raw", "JSON"],
  ["JSON", JSON, "isRaw", "JSON"],
  ["Number", Number, "EPS", "ILON"],
  ["Number", Number, "MIN_SAFE_", "INTEGER"],
  ["Number.prototype", Number.prototype, "toPre", "cision"],
  ["Number.prototype", Number.prototype, "toExpo", "nential"],
  ["String", String, "fromCode", "Point"],
  ["String.prototype", String.prototype, "anc", "hor"],
  ["String.prototype", String.prototype, "font", "color"],
  ["String.prototype", String.prototype, "isWell", "Formed"],
  ["String.prototype", String.prototype, "locale", "Compare"],
  ["Array", Array, "from", "Async"],
  ["Array.prototype", Array.prototype, "copy", "Within"],
  ["Array.prototype", Array.prototype, "toSp", "liced"],
  ["Array.prototype", Array.prototype, "find", "LastIndex"],
  ["Object", Object, "getOwnProperty", "Descriptors"],
  ["Object", Object, "prevent", "Extensions"],
  ["Object.prototype", Object.prototype, "__lookup", "Setter__"],
  ["Object.prototype", Object.prototype, "propertyIs", "Enumerable"],
  ["Reflect", Reflect, "getOwnProperty", "Descriptor"],
  ["Reflect", Reflect, "isExten", "sible"],
  ["Symbol", Symbol, "async", "Iterator"],
  ["Symbol", Symbol, "unsco", "pables"],
  ["Symbol", Symbol, "isConcat", "Spreadable"],
  ["Date", Date, "U", "TC"],
  ["Date.prototype", Date.prototype, "getTimezone", "Offset"],
  ["Date.prototype", Date.prototype, "setUTC", "Milliseconds"],
  ["RegExp.prototype", RegExp.prototype, "has", "Indices"],
  ["RegExp.prototype", RegExp.prototype, "unicode", "Sets"],
  ["Promise", Promise, "with", "Resolvers"],
  ["Promise", Promise, "all", "Settled"],
  ["Error", Error, "capture", "StackTrace"],
  ["Error", Error, "stackTrace", "Limit"],
  ["Atomics", Atomics, "compare", "Exchange"],
  ["Intl", Intl, "Seg", "menter"],
  ["Intl", Intl, "supportedValues", "Of"],
  ["BigInt", BigInt, "asUint", "N"],
  ["Map.prototype", Map.prototype, "getOr", "Insert"],
  ["Set.prototype", Set.prototype, "isDisjoint", "From"],
  ["Set.prototype", Set.prototype, "symmetric", "Difference"],
  ["ArrayBuffer.prototype", ArrayBuffer.prototype, "transferToFixed", "Length"],
  ["Uint8Array", Uint8Array, "BYTES_PER_", "ELEMENT"],
  ["Uint8Array", Uint8Array, "from", "Base64"],
  ["Uint8Array.prototype", Uint8Array.prototype, "to", "Hex"],
  ["DataView.prototype", DataView.prototype, "getBig", "Uint64"],
  ["globalThis", globalThis, "Weak", "Ref"],
  ["globalThis", globalThis, "Finalization", "Registry"],
  ["globalThis", globalThis, "SharedArray", "Buffer"],
  ["globalThis", globalThis, "decodeURI", "Component"],
  ["globalThis", globalThis, "structured", "Clone"],
  ["globalThis", globalThis, "queue", "Microtask"],
  ["globalThis", globalThis, "Text", "DecoderStream"],
  ["globalThis", globalThis, "Broadcast", "Channel"],
  ["globalThis", globalThis, "Compression", "Stream"],
  ["globalThis", globalThis, "no", "SuchThing"],
  ["console", console, "time", "Log"],
  ["console", console, "group", "Collapsed"],
  ["process", process, "hr", "time"],
  ["process", process, "emit", "Warning"],
  ["process", process, "memory", "Usage"],
  ["Buffer", Buffer, "byte", "Length"],
  ["Buffer", Buffer, "pool", "Size"],
  ["Buffer.prototype", Buffer.prototype, "readUInt", "32LE"],
  ["Buffer.prototype", Buffer.prototype, "writeBigInt", "64BE"],
  ["Bun", Bun, "escape", "HTML"],
  ["Bun", Bun, "string", "Width"],
  ["Bun", Bun, "deep", "Equals"],
  ["a list", [], "last", "IndexOf"],
  ["a text", "text", "code", "PointAt"],
  ["a number", 5, "toLocale", "String"],
  ["a function", function () {}, "app", "ly"],
  ["a pattern", /a/, "dot", "All"],
  ["a date", new Date(0), "toISO", "String"],
  ["a map", new Map(), "for", "Each"],
  ["a promise", Promise.resolve(), "fin", "ally"],
  ["an error", new RangeError("m"), "mess", "age"],
  ["a symbol", Symbol("d"), "descrip", "tion"],
  ["a generator", (function* () {})(), "ret", "urn"],
  ["arguments", (function () { return arguments; })(), "cal", "lee"],
];

for (const [name, object, first, second] of rows) {
  attempt(name + " " + first + "+" + second, () => kind(read(object, first, second)));
  attempt(name + " has " + first + "+" + second, () => has(Object(object), first, second));
}

attempt("the old members of RegExp", () => [typeof read(RegExp, "left", "Context"), typeof read(RegExp, "last", "Paren"), has(RegExp, "right", "Context")]);
attempt("calls", () => [call(Math, "cl", "z32", 1), call(Math, "hyp", "ot", 3, 4), call(Number.prototype.toString, "ca", "ll", 255, 16), call("abc", "code", "PointAt", 1), call([3, 1, 2], "toSor", "ted"), call(Object, "from", "Entries", [["a", 1]]), call(String, "fromCode", "Point", 128512), call(Bun, "escape", "HTML", "<a>"), call(Buffer, "byte", "Length", "hé")]);
