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

const names = ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float16Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array"];

const log = [];
const values = [
  300,
  -1,
  1.7,
  -1.7,
  0.5,
  1.5,
  2.5,
  NaN,
  -0,
  2 ** 31,
  2 ** 32 + 3,
  2 ** 40 + 3,
  -(2 ** 31) - 1,
  1e100,
  Infinity,
  -Infinity,
  65520,
  0.1,
  "5",
  "x",
  "",
  undefined,
  null,
  true,
  [7],
  { valueOf() { log.push("valueOf"); return 8; } },
  5n,
  -1n,
  2n ** 64n + 5n,
];

function storeOne(list, index, value) {
  list[index] = value;
  return list[index];
}

function fillFrom(list, source) {
  for (let i = 0; i < list.length; i++) list[i] = source[i];
  return list;
}

function addOne(list) {
  for (let i = 0; i < list.length; i++) list[i] += 1;
  return list;
}

function increment(list) {
  const answers = [];
  for (let i = 0; i < list.length; i++) answers.push(list[i]++);
  return answers;
}

function scale(list) {
  for (let i = 0; i < list.length; i++) list[i] = list[i] * 1.5;
  return list;
}

for (let i = 0; i < 2000; i++) {
  storeOne([0, 0], 1, i);
  fillFrom([0, 0, 0], [1, 2, 3]);
  addOne([1, 2, 3]);
  increment([1, 2, 3]);
  scale([1, 2, 3]);
}

for (const name of ["Array", ...names]) {
  const kind = globalThis[name];
  if (!kind) continue;
  const answers = [];
  for (const value of values) {
    let answer;
    try {
      answer = describe(storeOne(new kind(2), 1, value));
    } catch (error) {
      answer = error.constructor.name;
    }
    answers.push(answer);
  }
  console.log(name + ", one store each: " + answers.join(" | "));
  const isBig = name.startsWith("Big");
  attempt(name + ", filled from numbers", () => fillFrom(new kind(4), [255, 256, -129, 3.9]));
  attempt(name + ", filled from a shorter array", () => fillFrom(new kind(3), [1]));
  attempt(name + ", filled from big integers", () => fillFrom(new kind(2), [2n ** 63n, -1n]));
  attempt(name + ", one added at the limits", () => addOne(isBig ? kind.of(2n ** 63n - 1n, 2n ** 64n - 1n, -1n) : kind.of(127, 255, 32767, 65535, 2147483647, 4294967295, -1, 0.5)));
  attempt(name + ", incremented at the limits", () => {
    const list = isBig ? kind.of(2n ** 63n - 1n, 2n ** 64n - 1n, -1n) : kind.of(127, 255, 32767, 65535, 2147483647, 4294967295, -1, 0.5);
    return [increment(list), list];
  });
  attempt(name + ", scaled", () => scale(isBig ? kind.of(1n) : kind.of(1, 3, 100, 200, -3)));
  attempt(name + ", a store past the end", () => { const list = new kind(2); return [storeOne(list, 2, isBig ? 1n : 1), list.length, Object.keys(list).join()]; });
  attempt(name + ", a store at -1", () => { const list = new kind(2); return [storeOne(list, -1, isBig ? 1n : 1), Object.keys(list).join()]; });
  attempt(name + ", a store at 1.5", () => { const list = new kind(2); return [storeOne(list, 1.5, isBig ? 1n : 1), Object.keys(list).join()]; });
  attempt(name + ", a store at a name", () => { const list = new kind(2); return [storeOne(list, "name", 1), Object.keys(list).join()]; });
}
console.log("valueOf ran " + log.length + " times");
