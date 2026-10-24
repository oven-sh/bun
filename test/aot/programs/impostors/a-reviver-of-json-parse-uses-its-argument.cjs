const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

const arrays = [
  ["an array", "[5,6]"],
  ["an object with a length", "{\"0\":5,\"length\":7}"],
  ["an object whose push is a number", "{\"push\":1,\"length\":2}"],
  ["a string", "\"ab\""],
  ["null", "null"],
  ["a number", "12"],
];

const strings = [
  ["a string", "\"abc\""],
  ["an array", "[\"abc\"]"],
  ["a number", "65"],
  ["an object whose charCodeAt is a number", "{\"charCodeAt\":0}"],
  ["null", "null"],
];

const numbers = [
  ["an integer", "7"],
  ["a string", "\"3\""],
  ["null", "null"],
  ["the largest int32", "2147483647"],
  ["minus zero", "-0"],
  ["too large", "1e400"],
  ["a fraction", "2.5"],
  ["an array of one number", "[4]"],
  ["an object", "{}"],
  ["true", "true"],
  ["an object whose valueOf is a number", "{\"valueOf\":1}"],
];

const functions = [
  ["a number", "1"],
  ["an object", "{\"call\":1}"],
  ["null", "null"],
  ["a string", "\"f\""],
];

const objects = [
  ["an object", "{\"x\":1,\"y\":2}"],
  ["texts in another order", "{\"y\":\"2\",\"x\":\"1\"}"],
  ["a member is missing", "{\"x\":1}"],
  ["an array", "[1,2]"],
  ["members under a key called __proto__", "{\"__proto__\":{\"x\":1,\"y\":2}}"],
  ["a key twice", "{\"x\":1,\"y\":2,\"x\":\"again\"}"],
  ["null", "null"],
  ["a string", "\"xy\""],
  ["a number", "5"],
];

function pushes(text) {
  let result = "never called";
  JSON.parse(text, (key, a) => {
    if (key !== "value") return a;
    a.push(1);
    result = a.length;
    return a;
  });
  return result;
}

function iterates(text) {
  let result = "never called";
  JSON.parse(text, (key, a) => {
    if (key !== "value") return a;
    const seen = [];
    for (const x of a) seen.push(x);
    result = seen;
    return a;
  });
  return result;
}

function readsCharCode(text) {
  let result = "never called";
  JSON.parse(text, (key, s) => {
    if (key !== "value") return s;
    result = s.charCodeAt(0);
    return s;
  });
  return result;
}

function truncates(text) {
  let result = "never called";
  JSON.parse(text, (key, n) => {
    if (key !== "value") return n;
    result = n | 0;
    return n;
  });
  return result;
}

function addsOne(text) {
  let result = "never called";
  JSON.parse(text, (key, n) => {
    if (key !== "value") return n;
    result = n + 1;
    return n;
  });
  return result;
}

function calls(text) {
  let result = "never called";
  JSON.parse(text, (key, f) => {
    if (key !== "value") return f;
    result = f(1);
    return f;
  });
  return result;
}

function addsMembers(text) {
  let result = "never called";
  JSON.parse(text, (key, o) => {
    if (key !== "value") return o;
    result = o.x + o.y;
    return o;
  });
  return result;
}

function storesMember(text) {
  let result = "never called";
  JSON.parse(text, (key, o) => {
    if (key !== "value") return o;
    o.x = 1;
    result = o;
    return o;
  });
  return result;
}

const table = [
  ["pushes", pushes, arrays],
  ["iterates", iterates, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["truncates", truncates, numbers],
  ["addsOne", addsOne, numbers],
  ["calls", calls, functions],
  ["addsMembers", addsMembers, objects],
  ["storesMember", storesMember, objects],
];

function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, text] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use('{"value":' + text + "}"));
  }
}

console.log("strict:", (function () { return this === undefined; })());
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes('{"value":' + "[5,6]" + "}");
  iterates('{"value":' + "[5,6]" + "}");
  readsCharCode('{"value":' + "\"abc\"" + "}");
  truncates('{"value":' + "7" + "}");
  addsOne('{"value":' + "7" + "}");
  addsMembers('{"value":' + "{\"x\":1,\"y\":2}" + "}");
  storesMember('{"value":' + "{\"x\":1,\"y\":2}" + "}");
}
everyCase("after 2000");
