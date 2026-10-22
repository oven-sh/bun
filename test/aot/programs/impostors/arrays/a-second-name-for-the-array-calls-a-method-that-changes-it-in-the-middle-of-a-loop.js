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

const otherPrototype = {
  __proto__: Array.prototype,
  3: "inherited",
  *[Symbol.iterator]() {
    yield "the other prototype's iterator";
  },
};

function sumWhileItsOtherNamePushes(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.push(7);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNamePushes(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.push(7);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNamePushes(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.push(7);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNamePushesMany(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNamePushesMany(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNamePushesMany(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNamePops(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.pop();
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNamePops(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.pop();
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNamePops(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.pop();
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameShifts(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.shift();
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameShifts(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.shift();
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameShifts(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.shift();
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameUnshifts(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.unshift(0);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameUnshifts(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.unshift(0);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameUnshifts(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.unshift(0);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameSplices(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.splice(2, 2);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameSplices(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.splice(2, 2);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameSplices(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.splice(2, 2);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameReverses(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.reverse();
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameReverses(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.reverse();
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameReverses(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.reverse();
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameFills(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.fill(9);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameFills(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.fill(9);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameFills(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.fill(9);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameFillsWithDoubles(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.fill(0.5);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameFillsWithDoubles(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.fill(0.5);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameFillsWithDoubles(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.fill(0.5);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameCopiesWithin(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.copyWithin(2, 0);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameCopiesWithin(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.copyWithin(2, 0);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameCopiesWithin(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.copyWithin(2, 0);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameSorts(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.sort((a, b) => (a < b ? 1 : -1));
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameSorts(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.sort((a, b) => (a < b ? 1 : -1));
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameSorts(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.sort((a, b) => (a < b ? 1 : -1));
    list[i] = i;
  }
  return list.length;
}

const uses = {
  sumWhileItsOtherNamePushes,
  walkWhileItsOtherNamePushes,
  storeWhileItsOtherNamePushes,
  sumWhileItsOtherNamePushesMany,
  walkWhileItsOtherNamePushesMany,
  storeWhileItsOtherNamePushesMany,
  sumWhileItsOtherNamePops,
  walkWhileItsOtherNamePops,
  storeWhileItsOtherNamePops,
  sumWhileItsOtherNameShifts,
  walkWhileItsOtherNameShifts,
  storeWhileItsOtherNameShifts,
  sumWhileItsOtherNameUnshifts,
  walkWhileItsOtherNameUnshifts,
  storeWhileItsOtherNameUnshifts,
  sumWhileItsOtherNameSplices,
  walkWhileItsOtherNameSplices,
  storeWhileItsOtherNameSplices,
  sumWhileItsOtherNameReverses,
  walkWhileItsOtherNameReverses,
  storeWhileItsOtherNameReverses,
  sumWhileItsOtherNameFills,
  walkWhileItsOtherNameFills,
  storeWhileItsOtherNameFills,
  sumWhileItsOtherNameFillsWithDoubles,
  walkWhileItsOtherNameFillsWithDoubles,
  storeWhileItsOtherNameFillsWithDoubles,
  sumWhileItsOtherNameCopiesWithin,
  walkWhileItsOtherNameCopiesWithin,
  storeWhileItsOtherNameCopiesWithin,
  sumWhileItsOtherNameSorts,
  walkWhileItsOtherNameSorts,
  storeWhileItsOtherNameSorts,
};

const kinds = {
  integers: () => [1, 2, 3, 4, 5, 6],
  doubles: () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5],
  strings: () => ["a", "b", "c", "d", "e", "f"],
};

for (const use in uses) for (let i = 0; i < 300; i++) uses[use]([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]);

for (const use in uses) {
  for (const kind in kinds) {
    const list = kinds[kind]();
    let answer;
    try {
      answer = describe(uses[use](list, list));
    } catch (error) {
      answer = "threw " + error.constructor.name;
    }
    console.log(use + ", " + kind + ": " + answer + " and left " + describe(list));
  }
  const one = [1, 2, 3, 4, 5, 6];
  attempt(use + ", two arrays", () => [uses[use](one, [1, 2, 3, 4, 5, 6]), one]);
}

module.exports = uses;
