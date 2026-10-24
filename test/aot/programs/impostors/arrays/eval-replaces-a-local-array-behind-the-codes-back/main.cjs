function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function pushAfter(text) {
  var list = [3, 1, 2];
  eval(text);
  return list.push(9);
}

function sumAfter(text) {
  var list = [3, 1, 2];
  eval(text);
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function sumWithAnEvalInTheLoop(text) {
  let list = [3, 1, 2];
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    if (i === 1) eval(text);
    total += list[i];
  }
  return total;
}

function collectAfter(text) {
  const holder = { list: [3, 1, 2] };
  var list = holder.list;
  eval(text);
  const seen = [];
  for (const value of list) seen.push(value);
  return seen;
}

function doubledAfter(text) {
  var list = [3, 1, 2];
  eval(text);
  return list.map(value => value * 2);
}

function copiedAfter(text) {
  var list = [3, 1, 2];
  eval(text);
  return [...list];
}

function firstTwoAfter(text) {
  var list = [3, 1, 2];
  eval(text);
  const [a, b] = list;
  return [a, b];
}

function throughAClosure(text) {
  let list = [3, 1, 2];
  const read = () => list.length;
  eval(text);
  return read();
}

function declaredByTheEval(text) {
  eval(text.replace("list =", "var fresh ="));
  return typeof fresh === "undefined" ? "nothing declared" : fresh.length;
}

const uses = { pushAfter, sumAfter, sumWithAnEvalInTheLoop, collectAfter, doubledAfter, copiedAfter, firstTwoAfter, throughAClosure, declaredByTheEval };

const texts = [
  "",
  "list = { 0: 7, 1: 8, length: 2 }",
  "list = { push() { return 'pushed'; }, map() { return 'mapped'; }, length: 0, *[Symbol.iterator]() { yield 'walked'; } }",
  "list = 'ab'",
  "list = new Set([7, 8])",
  "list = new Uint8Array([7, 8])",
  "list = null",
  "list = new Proxy([7, 8], {})",
  "list = Object.freeze([7, 8])",
  "list = [7.5, 'x', , null]",
  "list.length = 1",
  "list[1] = 'stored'",
  "list.push = () => 'its own push'",
  "delete list[1]",
  "Object.setPrototypeOf(list, null)",
  "Object.freeze(list)",
  "list[Symbol.iterator] = function* () { yield 'its own iterator'; }",
  "var list = [7, 8]",
];

function round(title) {
  for (const text of texts) for (const use in uses) attempt(title + ", " + use + ", " + JSON.stringify(text), () => uses[use](text));
}

round("at first");
for (const use in uses) for (let i = 0; i < 500; i++) uses[use]("");
round("after 500 calls that change nothing");
