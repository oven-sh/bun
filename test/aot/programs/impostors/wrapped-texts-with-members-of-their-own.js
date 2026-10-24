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

const log = [];
globalThis.log = log;

function report(label, run) {
  attempt(label, run);
  if (log.length) console.log("  log:", log.splice(0).join(", "));
}

function lengthOf(text) {
  return text.length;
}

function upper(text) {
  return text.toUpperCase();
}

function label(text) {
  return "<" + text + ">";
}

function template(text) {
  return `<${text}>`;
}

function isAbc(text) {
  return [text === "abc", text == "abc", text < "abd"];
}

function asKey(text) {
  return { abc: "by abc", changed: "by changed", other: "by other" }[text];
}

function number(text) {
  return +text;
}

function json(text) {
  return JSON.stringify([text, { text }]);
}

const uses = [
  ["length", lengthOf],
  ["upper", upper],
  ["label", label],
  ["template", template],
  ["comparisons", isAbc],
  ["as a key", asKey],
  ["to a number", number],
  ["JSON", json],
];

for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) use("abc");
}

const wrapped = [
  "new String('abc')",
  "Object('abc')",
  "Object.assign(new String('abc'), { extra: 1 })",
  "Object.assign(new String('abc'), { toString() { log.push('toString'); return 'changed'; } })",
  "Object.assign(new String('abc'), { valueOf() { log.push('valueOf'); return 'changed'; } })",
  "Object.assign(new String('abc'), { toString() { log.push('toString'); return 'changed'; }, valueOf() { log.push('valueOf'); return 'other'; } })",
  "Object.assign(new String('abc'), { [Symbol.toPrimitive](hint) { log.push('toPrimitive ' + hint); return 'changed'; } })",
  "Object.assign(new String('abc'), { toJSON() { log.push('toJSON'); return 'changed'; } })",
  "Object.assign(new String('abc'), { toString: undefined, valueOf: undefined })",
  "Object.assign(new String('abc'), { toUpperCase() { log.push('own toUpperCase'); return 'own'; } })",
  "Object.defineProperty(new String('abc'), 'toUpperCase', { get() { log.push('get toUpperCase'); return () => 'from a getter'; } })",
  "Object.setPrototypeOf(new String('abc'), { toString() { log.push('inherited toString'); return 'changed'; }, toUpperCase() { return 'inherited'; } })",
  "Object.setPrototypeOf(new String('abc'), null)",
  "Object.setPrototypeOf(new String('abc'), Array.prototype)",
  "Object.setPrototypeOf(new String('abc'), Number.prototype)",
  "Object.freeze(new String('abc'))",
  "new (class Loud extends String { toUpperCase() { return 'LOUD ' + super.toUpperCase(); } get length() { return 'overridden on the prototype'; } })('abc')",
  "new (class Odd extends String { constructor(text) { super(text + 'c'); } toString() { log.push('subclass toString'); return 'changed'; } })('ab')",
  "Reflect.construct(String, ['abc'], Array)",
  "Reflect.construct(Array, [], String)",
  "new String(new String('abc'))",
  "new String({ toString() { log.push('converted when wrapped'); return 'abc'; } })",
  "new String(['a', 'bc'])",
  "new String()",
  "new String(undefined)",
  "new String(null)",
];

for (const text of wrapped) {
  for (const [name, use] of uses) report(name + " of " + text, () => use(make(text)));
}
report("new String(symbol)", () => new String(Symbol("s")));
report("String(symbol)", () => String(Symbol("s")));
report("own members of a wrapped text", () => Reflect.ownKeys(Object.assign(new String("ab"), { extra: 1, 5: "five", 2: "two" })));
report("the characters cannot be stored over", () => {
  const text = new String("abc");
  try {
    text[0] = "x";
  } catch (error) {
    log.push("store threw " + error.constructor.name);
  }
  try {
    text.length = 1;
  } catch (error) {
    log.push("length threw " + error.constructor.name);
  }
  try {
    delete text[1];
  } catch (error) {
    log.push("delete threw " + error.constructor.name);
  }
  text[3] = "d";
  return [String(text), text.length, text[3], Object.keys(text)];
});
