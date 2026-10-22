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

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function last(list) {
  return list[list.length - 1];
}

function pastTheEnd(list) {
  return [list[list.length], list[-1], list[1.5], list["1"], list["-0"], list["01"]];
}

function collect(list) {
  const seen = [];
  for (const value of list) seen.push(value);
  return seen;
}

function doubled(list) {
  return list.map(value => value + value);
}

function halved(list) {
  return list.map(value => value / 2);
}

function aboveTen(list) {
  return list.filter(value => value > 10);
}

function sortedByDefault(list) {
  return list.sort();
}

function sortedDescending(list) {
  return list.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

function copied(list) {
  return [...list];
}

function firstAndRest(list) {
  const [first, ...rest] = list;
  return [first, rest];
}

function joined(list) {
  return list.join();
}

function sliced(list) {
  return list.slice(1, 3);
}

function reversedCopy(list) {
  return list.toReversed();
}

function appended(list) {
  list[list.length] = list[0];
  return list.length;
}

function places(list) {
  return [0 in list, 4 in list, -1 in list, "1.5" in list, "-0" in list, "length" in list];
}

function keys(list) {
  return Object.keys(list).join();
}

function json(list) {
  return JSON.stringify(list);
}

function concatenated(list) {
  return [0].concat(list).length;
}

const uses = { sum, last, pastTheEnd, collect, doubled, halved, aboveTen, sortedByDefault, sortedDescending, copied, firstAndRest, joined, sliced, reversedCopy, appended, places, keys, concatenated };

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([100, 9, 10, 1]);

for (const use in uses) attempt("Array, " + use, () => uses[use]([100, 9, 10, 1]));

for (const name of names) {
  const kind = globalThis[name];
  if (!kind) continue;
  const make = () => (name.startsWith("Big") ? new kind([100n, 9n, 10n, 1n]) : new kind([100, 9, 10, 1]));
  for (const use in uses) attempt(name + ", " + use, () => uses[use](make()));
  attempt(name + ", json", () => json(name.startsWith("Big") ? new kind(0) : make()));
}

for (const use in uses) attempt("Array again, " + use, () => uses[use]([100, 9, 10, 1]));
