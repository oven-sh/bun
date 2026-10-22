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

function sumWhileItsOtherNameStoresADouble(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other[3] = 0.5;
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameStoresADouble(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other[3] = 0.5;
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameStoresADouble(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other[3] = 0.5;
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameStoresAString(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other[3] = "s";
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameStoresAString(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other[3] = "s";
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameStoresAString(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other[3] = "s";
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameStoresAnObject(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other[3] = { valueOf: () => 100 };
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameStoresAnObject(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other[3] = { valueOf: () => 100 };
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameStoresAnObject(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other[3] = { valueOf: () => 100 };
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameStoresUndefined(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other[3] = undefined;
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameStoresUndefined(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other[3] = undefined;
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameStoresUndefined(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other[3] = undefined;
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameStoresBehind(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other[0] = "behind";
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameStoresBehind(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other[0] = "behind";
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameStoresBehind(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other[0] = "behind";
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameStoresFarAway(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other[50000] = 1;
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameStoresFarAway(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other[50000] = 1;
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameStoresFarAway(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other[50000] = 1;
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameShrinks(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.length = 2;
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameShrinks(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.length = 2;
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameShrinks(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.length = 2;
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameEmpties(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.length = 0;
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameEmpties(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.length = 0;
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameEmpties(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.length = 0;
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameGrows(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.length = 8;
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameGrows(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.length = 8;
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameGrows(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.length = 8;
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameDeletes(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) delete other[3];
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameDeletes(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) delete other[3];
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameDeletes(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) delete other[3];
    list[i] = i;
  }
  return list.length;
}

const uses = {
  sumWhileItsOtherNameStoresADouble,
  walkWhileItsOtherNameStoresADouble,
  storeWhileItsOtherNameStoresADouble,
  sumWhileItsOtherNameStoresAString,
  walkWhileItsOtherNameStoresAString,
  storeWhileItsOtherNameStoresAString,
  sumWhileItsOtherNameStoresAnObject,
  walkWhileItsOtherNameStoresAnObject,
  storeWhileItsOtherNameStoresAnObject,
  sumWhileItsOtherNameStoresUndefined,
  walkWhileItsOtherNameStoresUndefined,
  storeWhileItsOtherNameStoresUndefined,
  sumWhileItsOtherNameStoresBehind,
  walkWhileItsOtherNameStoresBehind,
  storeWhileItsOtherNameStoresBehind,
  sumWhileItsOtherNameStoresFarAway,
  walkWhileItsOtherNameStoresFarAway,
  storeWhileItsOtherNameStoresFarAway,
  sumWhileItsOtherNameShrinks,
  walkWhileItsOtherNameShrinks,
  storeWhileItsOtherNameShrinks,
  sumWhileItsOtherNameEmpties,
  walkWhileItsOtherNameEmpties,
  storeWhileItsOtherNameEmpties,
  sumWhileItsOtherNameGrows,
  walkWhileItsOtherNameGrows,
  storeWhileItsOtherNameGrows,
  sumWhileItsOtherNameDeletes,
  walkWhileItsOtherNameDeletes,
  storeWhileItsOtherNameDeletes,
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
