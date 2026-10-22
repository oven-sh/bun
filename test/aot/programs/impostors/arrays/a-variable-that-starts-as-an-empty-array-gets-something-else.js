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

function replacedBeforeThePush(other) {
  let list = [];
  if (other !== undefined) list = other;
  return [list.push(1), list.length];
}

function replacedInTheLoop(other) {
  let list = [];
  const answers = [];
  for (let i = 0; i < 4; i++) {
    if (i === 2 && other !== undefined) list = other;
    answers.push(list.push(i));
  }
  return [answers, list.length];
}

function replacedBeforeTheWalk(other) {
  let list = [];
  list.push(1, 2);
  if (other !== undefined) list = other;
  const seen = [];
  for (const value of list) seen.push(value);
  return seen;
}

function replacedBeforeTheSum(other) {
  var list = [];
  list[0] = 1;
  list[1] = 2;
  if (other !== undefined) list = other;
  var total = 0;
  for (var i = 0; i < list.length; i++) total += list[i];
  return total;
}

function chosen(other) {
  const list = other === undefined ? [] : other;
  list[list.length] = 5;
  return [list.length, list[0]];
}

function defaulted(list = []) {
  list.push(1);
  return list.length;
}

function orEmpty(other) {
  const list = other || [];
  return [list.length, list.map(value => value * 2)];
}

function nullishOrEmpty(other) {
  const list = other ?? [];
  return [...list, "end"];
}

function reassignedByItsOwnMethod(other) {
  let list = [];
  list = list.concat(other === undefined ? [1] : other);
  list = list.map(value => value);
  return [list.length, list[0]];
}

function throughAClosure(other) {
  let list = [];
  const replace = () => {
    if (other !== undefined) list = other;
  };
  list.push(1);
  replace();
  return [list.length, list.push(2)];
}

function accumulated(other) {
  let out = [];
  for (const value of [1, 2, 3]) {
    out.push(value);
    if (value === 2 && other !== undefined) out = other;
  }
  return out.length;
}

const uses = { replacedBeforeThePush, replacedInTheLoop, replacedBeforeTheWalk, replacedBeforeTheSum, chosen, defaulted, orEmpty, nullishOrEmpty, reassignedByItsOwnMethod, throughAClosure, accumulated };

class Loud extends Array {
  push() {
    return "the subclass's push";
  }
  map() {
    return "the subclass's map";
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const others = {
  "nothing": () => undefined,
  "an array": () => [7, 8],
  "an array-like": () => ({ 0: 7, 1: 8, length: 2 }),
  "an array-like with methods": () => ({ 0: 7, length: 1, push: Array.prototype.push, map: Array.prototype.map, [Symbol.iterator]: Array.prototype.values }),
  "a subclass": () => Loud.of(7, 8),
  "a string": () => "78",
  "an empty string": () => "",
  "a Set": () => new Set([7, 8]),
  "a typed array": () => new Uint8Array([7, 8]),
  "a frozen array": () => Object.freeze([7, 8]),
  "a proxy": () => new Proxy([7, 8], {}),
  "doubles": () => [7.5, 8.5],
  "strings": () => ["seven", "eight"],
  "an array of holes": () => new Array(2),
  "zero": () => 0,
  "null": () => null,
  "a function": () => function (a, b) {},
};

function round(title) {
  for (const name in others) for (const use in uses) attempt(title + ", " + use + ", " + name, () => uses[use](others[name]()));
}

for (const use in uses) for (let i = 0; i < 2000; i++) uses[use](undefined);
round("after 2000 calls that replace nothing");
