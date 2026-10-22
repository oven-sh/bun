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

function sumWhileStoring(list, other, value) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total += list[i];
    if (i === 1) other[3] = value;
  }
  return total;
}

function sumWhileShrinking(list, other) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total += list[i];
    if (i === 1) other.length = 3;
  }
  return total;
}

function sumWhilePushing(list, other) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total += list[i];
    if (i < 40) other.push(1);
  }
  return total;
}

function sumWhilePopping(list, other) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total += list[i];
    other.pop();
  }
  return total;
}

function copyInto(list, other) {
  for (let i = 0; i < list.length && i < 12; i++) other[i + 1] = list[i];
  return other.length;
}

function walkWhileStoring(list, other, value) {
  const seen = [];
  for (const element of list) {
    seen.push(element);
    if (seen.length === 2) other[3] = value;
  }
  return seen;
}

function walkWhilePushing(list, other) {
  let count = 0;
  for (const element of list) {
    count++;
    if (count < 10) other.push(element);
  }
  return count;
}

function mapWhileStoring(list, other, value) {
  return list.map((element, index) => {
    if (index === 1) other[3] = value;
    return element;
  });
}

function readStoreRead(list, other, value) {
  const before = list[0];
  other[0] = value;
  return [before, list[0]];
}

function lengthStoreLength(list, other) {
  const before = list.length;
  other[other.length] = 1;
  return [before, list.length];
}

function swapThroughBoth(list, other) {
  const held = list[0];
  other[0] = list[1];
  list[1] = held;
  return [list[0], other[1]];
}

const kinds = {
  integers: () => [1, 2, 3, 4, 5, 6],
  doubles: () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5],
  strings: () => ["a", "b", "c", "d", "e", "f"],
};

const values = { "a double": 0.25, "a string": "s", "an integer": 7, undefined: undefined, "an object": { valueOf: () => 50 }, "a negative zero": -0, "a large number": 2 ** 31 };

const withAValue = { sumWhileStoring, walkWhileStoring, mapWhileStoring, readStoreRead };
const withoutAValue = { sumWhileShrinking, sumWhilePushing, sumWhilePopping, copyInto, walkWhilePushing, lengthStoreLength, swapThroughBoth };

for (let i = 0; i < 2000; i++) {
  for (const use in withAValue) withAValue[use]([1, 2, 3, 4, 5, 6], [0, 0, 0, 0, 0, 0], 7);
  for (const use in withoutAValue) withoutAValue[use]([1, 2, 3, 4, 5, 6], [0, 0, 0, 0, 0, 0]);
}

for (const kind in kinds) {
  for (const use in withAValue) {
    for (const name in values) {
      const list = kinds[kind]();
      attempt(kind + ", " + use + ", " + name, () => [withAValue[use](list, list, values[name]), list]);
    }
  }
  for (const use in withoutAValue) {
    const list = kinds[kind]();
    attempt(kind + ", " + use, () => [withoutAValue[use](list, list), list]);
    const one = kinds[kind]();
    const two = kinds[kind]();
    attempt(kind + ", " + use + ", two arrays", () => [withoutAValue[use](one, two), one, two]);
  }
}
