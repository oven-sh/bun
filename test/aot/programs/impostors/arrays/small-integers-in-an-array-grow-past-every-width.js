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

const limits = [0, 1, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2 ** 24, 2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1, 0.5, -0];

const builders = {
  literal: () => [1, 2, 3, 4],
  zeros: () => [0, 0, 0, 0],
  pushed() {
    const out = [];
    for (let i = 0; i < 4; i++) out.push(i);
    return out;
  },
  filled: () => new Array(4).fill(1),
  from: () => Array.from({ length: 4 }, (_, index) => index),
  mapped: () => [10, 20, 30, 40].map(value => value / 10),
  bytes: () => Array.from(new Uint8Array([1, 2, 3, 4])),
  flags: () => [1, 0, 1, 0],
  codes: () => Array.from("abcd", letter => letter.charCodeAt(0)),
};

function store(list, value) {
  list[1] = value;
  return list;
}

function push(list, value) {
  list.push(value);
  return list;
}

function add(list, value) {
  list[1] += value;
  return list;
}

function multiply(list, value) {
  for (let i = 0; i < list.length; i++) list[i] *= value;
  return list;
}

function fill(list, value) {
  return list.fill(value, 2);
}

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

const changes = { store, push, add, multiply, fill };

function text(list) {
  const parts = [];
  for (let i = 0; i < list.length; i++) parts.push(Object.is(list[i], -0) ? "-0" : String(list[i]));
  return parts.join(" ");
}

for (let i = 0; i < 1000; i++) for (const builder in builders) for (const change in changes) sum(changes[change](builders[builder](), i & 7));

for (const builder in builders) {
  for (const change in changes) {
    const answers = [];
    for (const limit of limits) {
      const list = changes[change](builders[builder](), limit);
      answers.push(text(list) + " = " + (Object.is(sum(list), -0) ? "-0" : sum(list)));
    }
    console.log(builder + ", " + change + ": " + answers.join(" | "));
  }
}

function countUp(list, turns) {
  for (let turn = 0; turn < turns; turn++) for (let i = 0; i < list.length; i++) list[i]++;
  return list;
}

function double(list, turns) {
  for (let turn = 0; turn < turns; turn++) for (let i = 0; i < list.length; i++) list[i] += list[i];
  return list;
}

console.log("counted up from 120: " + text(countUp([120, 250, 32760, 65530, 2147483640], 20)));
console.log("counted up again: " + text(countUp([120, 250, 32760, 65530, 2147483640], 20)));
console.log("doubled 40 times: " + text(double([1, 3, -1, 100], 40)));
console.log("doubled 1100 times: " + text(double([1, -1], 1100)));
