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

const patterns = [
  0x7ff8000000000000n,
  0xfff8000000000000n,
  0x7ff0000000000001n,
  0xfff0000000000001n,
  0x7fffffffffffffffn,
  0xffffffffffffffffn,
  0xfffe000000000000n,
  0xfffe000000001234n,
  0xfffc000000000002n,
  0xfffd00000000000an,
  0xfff9000012345678n,
  0xffff000000000007n,
  0x7ff8dead0000beefn,
  0xfffa000000000006n,
];

const patterns32 = [0x7fc00000, 0xffc00000, 0x7f800001, 0xff800001, 0x7fffffff, 0xffffffff, 0xffc01234];

function first(list) {
  return list[0];
}

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function intoAnArray(list) {
  const out = [1.5];
  out[0] = list[0];
  out.push(list[0]);
  return out;
}

function intoAnObject(list) {
  return { value: list[0] };
}

function copied(list) {
  return [...list];
}

function mapped(list) {
  return Array.from(list, value => value);
}

function walked(list) {
  for (const value of list) return value;
}

function throughAView(list) {
  return new DataView(list.buffer).getFloat64(0, true);
}

function judged(value) {
  return [typeof value, Object.is(value, NaN), value !== value, String(value), value | 0, Number.isNaN(value), [value].includes(NaN), JSON.stringify([value])].join(" ");
}

for (let i = 0; i < 1000; i++) {
  const honest = new Float64Array([i + 0.5]);
  first(honest);
  sum(honest);
  intoAnArray(honest);
  intoAnObject(honest);
  copied(honest);
  mapped(honest);
  walked(honest);
  throughAView(honest);
}

for (const bits of patterns) {
  const list = new Float64Array(new BigUint64Array([bits]).buffer);
  const label = "0x" + bits.toString(16);
  console.log(label + ", first: " + judged(first(list)));
  console.log(label + ", sum: " + judged(sum(list)));
  const array = intoAnArray(list);
  console.log(label + ", into an array: " + judged(array[0]) + " | " + judged(array[1]) + " | " + (0 in array) + " " + (1 in array) + " " + array.length);
  console.log(label + ", into an object: " + judged(intoAnObject(list).value));
  console.log(label + ", copied: " + judged(copied(list)[0]));
  console.log(label + ", mapped: " + judged(mapped(list)[0]));
  console.log(label + ", walked: " + judged(walked(list)));
  console.log(label + ", through a view: " + judged(throughAView(list)));
  console.log(label + ", at, find, reduce: " + judged(list.at(0)) + " | " + judged(list.find(() => true)) + " | " + judged(list.reduce((_, value) => value, 0)));
}

for (const bits of patterns32) {
  const list = new Float32Array(new Uint32Array([bits]).buffer);
  const label = "0x" + bits.toString(16);
  console.log(label + ", first: " + judged(first(list)));
  console.log(label + ", sum: " + judged(sum(list)));
  console.log(label + ", into an array: " + judged(intoAnArray(list)[1]));
  console.log(label + ", copied: " + judged(copied(list)[0]));
  console.log(label + ", through a view: " + judged(new DataView(list.buffer).getFloat32(0, true)));
}
