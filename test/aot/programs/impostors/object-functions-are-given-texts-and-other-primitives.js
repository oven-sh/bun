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

function keys(value) {
  return Object.keys(value);
}

function values(value) {
  return Object.values(value);
}

function entries(value) {
  return Object.entries(value);
}

function names(value) {
  return Object.getOwnPropertyNames(value);
}

function spread(value) {
  return { ...value };
}

function assigned(value) {
  return Object.assign({}, value);
}

function assignedInto(value) {
  return typeof Object.assign(value, { added: 1 });
}

function descriptorOfZero(value) {
  const found = Object.getOwnPropertyDescriptor(value, 0);
  return found && [found.value, found.writable, found.enumerable, found.configurable];
}

function descriptorOfLength(value) {
  const found = Object.getOwnPropertyDescriptor(value, "length");
  return found && [found.value, found.writable, found.enumerable, found.configurable];
}

function frozen(value) {
  return [Object.isFrozen(value), Object.isSealed(value), Object.isExtensible(value), Object.freeze(value) === value];
}

function prototypeName(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null ? "null" : prototype.constructor.name;
}

function reflected(value) {
  return Reflect.ownKeys(value).length;
}

function wrappedAgain(value) {
  return [typeof Object(value), Object(value) === value];
}

function fromEntries(value) {
  return Object.fromEntries(value);
}

function defined(value) {
  return typeof Object.defineProperty(value, "added", { value: 1 });
}

function cloned(value) {
  const copy = structuredClone(value);
  return [typeof copy, copy === value, copy];
}

const uses = [
  ["keys", keys],
  ["values", values],
  ["entries", entries],
  ["names", names],
  ["spread", spread],
  ["assign from", assigned],
  ["assign into", assignedInto],
  ["descriptor of 0", descriptorOfZero],
  ["descriptor of length", descriptorOfLength],
  ["frozen", frozen],
  ["prototype", prototypeName],
  ["Reflect.ownKeys", reflected],
  ["Object()", wrappedAgain],
  ["fromEntries", fromEntries],
  ["defineProperty", defined],
  ["structuredClone", cloned],
];

const given = [
  "{ 0: 'a', length: 1 }",
  "'ab'",
  "''",
  "'\\ud83d\\ude00'",
  "new String('ab')",
  "Object.assign(new String('ab'), { extra: 1 })",
  "['a', 'b']",
  "['ab', 'cd']",
  "[['k', 'v']]",
  "new Uint8Array([1])",
  "5",
  "true",
  "5n",
  "Symbol('s')",
  "null",
  "undefined",
  "new Map([['k', 'v']])",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [name, use] of uses) {
    if (name !== "fromEntries") total += String(use({ 0: "a", length: 1 })).length;
  }
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of given) attempt(name + " of " + text, () => use(make(text)));
}
