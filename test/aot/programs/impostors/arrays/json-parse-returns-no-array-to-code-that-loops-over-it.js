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

function pushInto(text) {
  const list = JSON.parse(text);
  return [list.push(9), list];
}

function sumOf(text) {
  const list = JSON.parse(text);
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function collect(text) {
  const seen = [];
  for (const value of JSON.parse(text)) seen.push(value);
  return seen;
}

function doubled(text) {
  return JSON.parse(text).map(value => value * 2);
}

function aboveOne(text) {
  return JSON.parse(text).filter(value => value > 1);
}

function sorted(text) {
  return JSON.parse(text).sort((a, b) => a - b);
}

function copied(text) {
  return [...JSON.parse(text)];
}

function firstTwo(text) {
  const [a, b = "default"] = JSON.parse(text);
  return [a, b];
}

function lengthOf(text) {
  return JSON.parse(text).length;
}

function itemsOf(text) {
  const { items } = JSON.parse(text);
  let total = 0;
  for (let i = 0; i < items.length; i++) total += items[i];
  return [total, items.push(9)];
}

const uses = {
  pushInto,
  sumOf,
  collect,
  firstTwo,
  lengthOf,
};

const texts = [
  '{"0":3,"1":1,"2":2,"length":3}',
  '{"length":3}',
  '{"length":"3","0":1}',
  '{"push":1,"length":0}',
  '{"__proto__":[3,1,2]}',
  '{"__proto__":[3,1,2],"length":1,"0":7}',
  '{}',
  '"312"',
  '""',
  "312",
  "null",
  "true",
  "[]",
  "[3,\"1\",2.5,null,{\"valueOf\":7}]",
  "[[3],[1],[2]]",
  "[3000000000,1,2]",
  "[1e400,-1e400,1]",
  "[-0,0,-0]",
  "[0.1,0.2,0.3]",
  "[3,1,2,9007199254740993]",
  '["c","a","b"]',
  "[null,null]",
  "[3,1,2]",
];

function round(title) {
  for (const text of texts) for (const use in uses) attempt(title + ", " + use + ", " + text, () => uses[use](text));
}

round("at first");
for (const use in uses) for (let i = 0; i < 2000; i++) uses[use]("[3,1,2]");
round("after 2000 arrays");

const holders = [
  '{"items":[3,1,2]}',
  '{"items":{"0":3,"length":1}}',
  '{"items":"312"}',
  '{"items":null}',
  '{"items":{"length":2,"0":1,"1":2,"push":0}}',
  "{}",
  "[]",
  '{"items":[3,1,2]}',
];
for (let i = 0; i < 2000; i++) itemsOf('{"items":[3,1,2]}');
for (const text of holders) attempt("itemsOf, " + text, () => itemsOf(text));
