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

function sumWhileItsOtherNameFreezes(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) Object.freeze(other);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameFreezes(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) Object.freeze(other);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameFreezes(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) Object.freeze(other);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameSeals(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) Object.seal(other);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameSeals(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) Object.seal(other);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameSeals(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) Object.seal(other);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNamePreventsExtensions(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) Object.preventExtensions(other);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNamePreventsExtensions(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) Object.preventExtensions(other);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNamePreventsExtensions(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) Object.preventExtensions(other);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameFixesTheLength(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) Object.defineProperty(other, "length", { writable: false });
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameFixesTheLength(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) Object.defineProperty(other, "length", { writable: false });
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameFixesTheLength(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) Object.defineProperty(other, "length", { writable: false });
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameDefinesAGetter(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) Object.defineProperty(other, 3, { get: () => 1000, configurable: true, enumerable: true });
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameDefinesAGetter(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) Object.defineProperty(other, 3, { get: () => 1000, configurable: true, enumerable: true });
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameDefinesAGetter(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) Object.defineProperty(other, 3, { get: () => 1000, configurable: true, enumerable: true });
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameMakesAnElementReadOnly(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) Object.defineProperty(other, 3, { writable: false });
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameMakesAnElementReadOnly(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) Object.defineProperty(other, 3, { writable: false });
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameMakesAnElementReadOnly(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) Object.defineProperty(other, 3, { writable: false });
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameRelinks(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) Object.setPrototypeOf(other, otherPrototype);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameRelinks(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) Object.setPrototypeOf(other, otherPrototype);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameRelinks(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) Object.setPrototypeOf(other, otherPrototype);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameRelinksAndDeletes(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) Object.setPrototypeOf(other, otherPrototype), delete other[3];
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameRelinksAndDeletes(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) Object.setPrototypeOf(other, otherPrototype), delete other[3];
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameRelinksAndDeletes(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) Object.setPrototypeOf(other, otherPrototype), delete other[3];
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameUnlinks(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) Object.setPrototypeOf(other, null);
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameUnlinks(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) Object.setPrototypeOf(other, null);
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameUnlinks(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) Object.setPrototypeOf(other, null);
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameAddsItsOwnIterator(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other[Symbol.iterator] = function* () { yield "its own iterator"; };
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameAddsItsOwnIterator(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other[Symbol.iterator] = function* () { yield "its own iterator"; };
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameAddsItsOwnIterator(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other[Symbol.iterator] = function* () { yield "its own iterator"; };
    list[i] = i;
  }
  return list.length;
}

function sumWhileItsOtherNameAddsAName(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.extra = 1;
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherNameAddsAName(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.extra = 1;
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherNameAddsAName(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.extra = 1;
    list[i] = i;
  }
  return list.length;
}

const uses = {
  sumWhileItsOtherNameFreezes,
  walkWhileItsOtherNameFreezes,
  storeWhileItsOtherNameFreezes,
  sumWhileItsOtherNameSeals,
  walkWhileItsOtherNameSeals,
  storeWhileItsOtherNameSeals,
  sumWhileItsOtherNamePreventsExtensions,
  walkWhileItsOtherNamePreventsExtensions,
  storeWhileItsOtherNamePreventsExtensions,
  sumWhileItsOtherNameFixesTheLength,
  walkWhileItsOtherNameFixesTheLength,
  storeWhileItsOtherNameFixesTheLength,
  sumWhileItsOtherNameDefinesAGetter,
  walkWhileItsOtherNameDefinesAGetter,
  storeWhileItsOtherNameDefinesAGetter,
  sumWhileItsOtherNameMakesAnElementReadOnly,
  walkWhileItsOtherNameMakesAnElementReadOnly,
  storeWhileItsOtherNameMakesAnElementReadOnly,
  sumWhileItsOtherNameRelinks,
  walkWhileItsOtherNameRelinks,
  storeWhileItsOtherNameRelinks,
  sumWhileItsOtherNameRelinksAndDeletes,
  walkWhileItsOtherNameRelinksAndDeletes,
  storeWhileItsOtherNameRelinksAndDeletes,
  sumWhileItsOtherNameUnlinks,
  walkWhileItsOtherNameUnlinks,
  storeWhileItsOtherNameUnlinks,
  sumWhileItsOtherNameAddsItsOwnIterator,
  walkWhileItsOtherNameAddsItsOwnIterator,
  storeWhileItsOtherNameAddsItsOwnIterator,
  sumWhileItsOtherNameAddsAName,
  walkWhileItsOtherNameAddsAName,
  storeWhileItsOtherNameAddsAName,
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
