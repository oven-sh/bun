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

function copyByPush(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    out.push(list[i]);
    if (out.length === 6) break;
  }
  return out;
}

function copyByIndex(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    out[i] = list[i];
    if (i === 5) break;
  }
  return out;
}

function copyIntoASizedArray(list) {
  const out = new Array(list.length);
  for (let i = 0; i < list.length && i < 6; i++) out[i] = list[i];
  return [out.length, Object.keys(out).join()];
}

function copyWithACachedLength(list) {
  const out = [];
  const length = list.length;
  for (let i = 0; i < length; i++) {
    out.push(list[i]);
    if (out.length === 6) break;
  }
  return out;
}

function countDown(list) {
  const out = [];
  for (let i = list.length; i-- > 0; ) {
    out.push(i);
    if (out.length === 3) break;
  }
  return out;
}

function lengthArithmetic(list) {
  let length = list.length;
  const next = length + 1;
  length++;
  return [next, length, list.length | 0, list.length >> 1, list.length >>> 0, list.length * 2, list.length - 1, -list.length, list.length % 7];
}

function middle(list) {
  return list[list.length >> 1];
}

function filled(list) {
  return Array.from({ length: list.length > 6 ? 6 : list.length }, (_, index) => index);
}

const uses = { copyByPush, copyByIndex, copyIntoASizedArray, copyWithACachedLength, countDown, lengthArithmetic, middle, filled };

function counting(answers) {
  let reads = 0;
  return {
    0: "a",
    1: "b",
    2: "c",
    get length() {
      return answers[Math.min(reads++, answers.length - 1)];
    },
  };
}

function like(length) {
  return { 0: "a", 1: "b", 2: "c", length };
}

const makers = {
  "an array": () => ["a", "b", "c"],
  "a length of 2.5": () => like(2.5),
  "a length of the text 2": () => like("2"),
  "a length of the text two": () => like("two"),
  "a negative length": () => like(-2),
  "a length of -0": () => like(-0),
  "a length of NaN": () => like(NaN),
  "an infinite length": () => like(Infinity),
  "a length of 2 ** 31": () => like(2 ** 31),
  "a length of 2 ** 32": () => like(2 ** 32),
  "a length of 2 ** 53": () => like(2 ** 53),
  "a length of null": () => like(null),
  "a length of undefined": () => like(undefined),
  "a length of true": () => like(true),
  "a length of 2n": () => like(2n),
  "a length that is an object": () => like({ valueOf: () => 2 }),
  "a length that is an array": () => like([2]),
  "a length that grows": () => counting([1, 2, 3, 4, 5]),
  "a length that shrinks": () => counting([3, 3, 2, 1, 0]),
  "a length that becomes text": () => counting([3, "3", "x"]),
  "an array of 2 ** 32 - 1 holes": () => { const list = []; list.length = 2 ** 32 - 1; return list; },
  "an array of 2 ** 31 holes": () => { const list = []; list.length = 2 ** 31; return list; },
  "a function of two parameters": () => function (a, b) {},
  "a string": () => "abc",
  "a typed array": () => new Uint8Array(3),
};

for (const use in uses) for (let i = 0; i < 2000; i++) uses[use](["a", "b", "c"]);

for (const name in makers) for (const use in uses) attempt(name + ", " + use, () => uses[use](makers[name]()));
