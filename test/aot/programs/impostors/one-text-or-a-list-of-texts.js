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

function asList(value) {
  return Array.isArray(value) ? value : [value];
}

function asListByTypeof(value) {
  return typeof value === "string" ? [value] : value;
}

function asListByConcat(value) {
  return [].concat(value);
}

function asListByFlat(value) {
  return [value].flat();
}

function totalLength(value) {
  let total = 0;
  for (const text of asList(value)) total += text.length;
  return total;
}

function totalLengthByTypeof(value) {
  let total = 0;
  for (const text of asListByTypeof(value)) total += text.length;
  return total;
}

function joinedUpper(value) {
  return asListByConcat(value)
    .map(text => text.toUpperCase())
    .join("+");
}

function firstText(value) {
  return typeof value === "string" ? value : value[0];
}

function countOf(value) {
  return typeof value === "string" ? 1 : value.length;
}

function classNames(...values) {
  const names = [];
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string" || typeof value === "number") names.push(value);
    else if (Array.isArray(value)) names.push(classNames(...value));
    else if (typeof value === "object") for (const key in value) if (value[key]) names.push(key);
  }
  return names.join(" ");
}

const uses = [
  ["as a list", asList],
  ["as a list by typeof", asListByTypeof],
  ["as a list by concat", asListByConcat],
  ["as a list by flat", asListByFlat],
  ["total length", totalLength],
  ["total length by typeof", totalLengthByTypeof],
  ["joined upper", joinedUpper],
  ["first text", firstText],
  ["count", countOf],
  ["class names", classNames],
];

const values = [
  "'one'",
  "['one', 'two']",
  "''",
  "[]",
  "[['nested']]",
  "new String('wrapped')",
  "[new String('wrapped')]",
  "new Set(['in', 'a', 'set'])",
  "{ length: 1, 0: 'array-like' }",
  "(function () { return arguments; })('from', 'arguments')",
  "Object.assign(['spreadable off'], { [Symbol.isConcatSpreadable]: false })",
  "{ length: 1, 0: 'spreadable on', [Symbol.isConcatSpreadable]: true }",
  "Object.assign(new String('ab'), { [Symbol.isConcatSpreadable]: true })",
  "new Proxy(['through a proxy'], {})",
  "class Words extends Array {}.of('sub', 'class')",
  "Buffer.from('ab')",
  "5",
  "null",
  "undefined",
  "['one', 2, null]",
  "{ active: true, hidden: 0, 'is-open': 'yes' }",
  "'one'[Symbol.iterator]()",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use(i % 2 ? "one" : ["one", "two"])).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) {
    attempt(name + " of " + text, () => {
      const given = make(text);
      const result = use(given);
      return result === given && typeof given === "object" && given !== null && !Array.isArray(given) ? "the same object" : result;
    });
  }
}

console.log("bytes made in plain sight", Buffer.from("he").length);
