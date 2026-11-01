// The programs of impostors that are mostly a loop written out: thousands of fields, variables or functions that differ in a number.
import { family, programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "arrays/a-second-name-for-the-array-calls-a-method-that-changes-it-in-the-middle-of-a-loop.js": text(
      `function describe(value) {
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
  },`,
      [
        `;	Pushes	push(7
	PushesMany	push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
	Pops	pop(
	Shifts	shift(
	Unshifts	unshift(0
	Splices	splice(2, 2
	Reverses	reverse(
	Fills	fill(9
	FillsWithDoubles	fill(0.5
	CopiesWithin	copyWithin(2, 0
	Sorts	sort((a, b) => (a < b ? 1 : -1)`,
        (n, a, b, c) => `}${a}

function sumWhileItsOtherName${b}(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) other.${c});
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherName${b}(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) other.${c});
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherName${b}(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) other.${c});
    list[i] = i;
  }
  return list.length;`,
      ],
      `}

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
`,
    ),
    "arrays/a-second-name-for-the-array-freezes-it-redefines-it-or-relinks-it-in-the-middle-of-a-loop.js": text(
      `function describe(value) {
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
  },`,
      [
        `;	Freezes	Object.freeze(other)
	Seals	Object.seal(other)
	PreventsExtensions	Object.preventExtensions(other)
	FixesTheLength	Object.defineProperty(other, "length", { writable: false })
	DefinesAGetter	Object.defineProperty(other, 3, { get: () => 1000, configurable: true, enumerable: true })
	MakesAnElementReadOnly	Object.defineProperty(other, 3, { writable: false })
	Relinks	Object.setPrototypeOf(other, otherPrototype)
	RelinksAndDeletes	Object.setPrototypeOf(other, otherPrototype), delete other[3]
	Unlinks	Object.setPrototypeOf(other, null)
	AddsItsOwnIterator	other[Symbol.iterator] = function* () { yield "its own iterator"; }
	AddsAName	other.extra = 1`,
        (n, a, b, c) => `}${a}

function sumWhileItsOtherName${b}(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) ${c};
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherName${b}(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) ${c};
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherName${b}(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) ${c};
    list[i] = i;
  }
  return list.length;`,
      ],
      `}

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
`,
    ),
    "arrays/a-second-name-for-the-array-stores-to-it-or-sets-its-length-in-the-middle-of-a-loop.js": text(
      `function describe(value) {
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
  },`,
      [
        `;	StoresADouble	other[3] = 0.5
	StoresAString	other[3] = "s"
	StoresAnObject	other[3] = { valueOf: () => 100 }
	StoresUndefined	other[3] = undefined
	StoresBehind	other[0] = "behind"
	StoresFarAway	other[50000] = 1
	Shrinks	other.length = 2
	Empties	other.length = 0
	Grows	other.length = 8
	Deletes	delete other[3]`,
        (n, a, b, c) => `}${a}

function sumWhileItsOtherName${b}(list, other) {
  let total = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    if (i === 1) ${c};
    total += list[i];
  }
  return total;
}

function walkWhileItsOtherName${b}(list, other) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) ${c};
    seen.push(value);
    if (seen.length === 10) break;
  }
  return seen;
}

function storeWhileItsOtherName${b}(list, other) {
  for (let i = 0; i < list.length && i < 10; i++) {
    if (i === 1) ${c};
    list[i] = i;
  }
  return list.length;`,
      ],
      `}

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
`,
    ),
    "built-ins-hand-something-else-to-a-function-whose-visible-callers-pass-an-array-to-iterate.cjs": text(
      `const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

const results = [];
function observe(label, run) {
  results.length = 0;
  const end = outcome(() => void (run()));
  console.log(label + " -> " + show(results) + " " + end);`,
      [
        `2(
5(
8(
11(
14(
17(
20(
23(
26(
29(
32(
35(
38(
41(
44(ignored, `,
        (n, a) => `}

function iterates${3 * n + 1}(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates${a}a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates${3 * n + 3}(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;`,
      ],
      `}

console.log("strict:", (function () { return this === undefined; })());

iterates1([5, 6]);
iterates1([5, 6]);
observe("forEach: an array", () => [([5, 6])].forEach(iterates1));
observe("forEach: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].forEach(iterates1));
observe("forEach: a subclass", () => [(Odd.of(5, 6))].forEach(iterates1));
observe("forEach: an array again", () => [([5, 6])].forEach(iterates1));

iterates2([5, 6]);
iterates2([5, 6]);
observe("map: an array", () => [([5, 6])].map(iterates2));
observe("map: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].map(iterates2));
observe("map: a subclass", () => [(Odd.of(5, 6))].map(iterates2));
observe("map: an array again", () => [([5, 6])].map(iterates2));

iterates3([5, 6]);
iterates3([5, 6]);
observe("filter: an array", () => [([5, 6])].filter(iterates3));
observe("filter: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].filter(iterates3));
observe("filter: a subclass", () => [(Odd.of(5, 6))].filter(iterates3));
observe("filter: an array again", () => [([5, 6])].filter(iterates3));

iterates4([5, 6]);
iterates4([5, 6]);
observe("some: an array", () => [([5, 6])].some(iterates4));
observe("some: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].some(iterates4));
observe("some: a subclass", () => [(Odd.of(5, 6))].some(iterates4));
observe("some: an array again", () => [([5, 6])].some(iterates4));

iterates5([5, 6]);
iterates5([5, 6]);
observe("every: an array", () => [([5, 6])].every(iterates5));
observe("every: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].every(iterates5));
observe("every: a subclass", () => [(Odd.of(5, 6))].every(iterates5));
observe("every: an array again", () => [([5, 6])].every(iterates5));

iterates6([5, 6]);
iterates6([5, 6]);
observe("find: an array", () => [([5, 6])].find(iterates6));
observe("find: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].find(iterates6));
observe("find: a subclass", () => [(Odd.of(5, 6))].find(iterates6));
observe("find: an array again", () => [([5, 6])].find(iterates6));

iterates7([5, 6]);
iterates7([5, 6]);
observe("findIndex: an array", () => [([5, 6])].findIndex(iterates7));
observe("findIndex: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].findIndex(iterates7));
observe("findIndex: a subclass", () => [(Odd.of(5, 6))].findIndex(iterates7));
observe("findIndex: an array again", () => [([5, 6])].findIndex(iterates7));

iterates8([5, 6]);
iterates8([5, 6]);
observe("findLast: an array", () => [([5, 6])].findLast(iterates8));
observe("findLast: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].findLast(iterates8));
observe("findLast: a subclass", () => [(Odd.of(5, 6))].findLast(iterates8));
observe("findLast: an array again", () => [([5, 6])].findLast(iterates8));

iterates9([5, 6]);
iterates9([5, 6]);
observe("flatMap: an array", () => [([5, 6])].flatMap(iterates9));
observe("flatMap: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].flatMap(iterates9));
observe("flatMap: a subclass", () => [(Odd.of(5, 6))].flatMap(iterates9));
observe("flatMap: an array again", () => [([5, 6])].flatMap(iterates9));

iterates10([5, 6]);
iterates10([5, 6]);
observe("sort: an array", () => [([5, 6]), ([5, 6])].sort(iterates10));
observe("sort: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })), (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].sort(iterates10));
observe("sort: a subclass", () => [(Odd.of(5, 6)), (Odd.of(5, 6))].sort(iterates10));
observe("sort: an array again", () => [([5, 6]), ([5, 6])].sort(iterates10));

iterates11([5, 6]);
iterates11([5, 6]);
observe("toSorted: an array", () => [([5, 6]), ([5, 6])].toSorted(iterates11));
observe("toSorted: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })), (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].toSorted(iterates11));
observe("toSorted: a subclass", () => [(Odd.of(5, 6)), (Odd.of(5, 6))].toSorted(iterates11));
observe("toSorted: an array again", () => [([5, 6]), ([5, 6])].toSorted(iterates11));

iterates12([5, 6]);
iterates12([5, 6]);
observe("reduce with a first value: an array", () => [0].reduce(iterates12, ([5, 6])));
observe("reduce with a first value: an array-like", () => [0].reduce(iterates12, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
observe("reduce with a first value: a subclass", () => [0].reduce(iterates12, (Odd.of(5, 6))));
observe("reduce with a first value: an array again", () => [0].reduce(iterates12, ([5, 6])));

iterates13([5, 6]);
iterates13([5, 6]);
observe("reduce without a first value: an array", () => [([5, 6]), 0].reduce(iterates13));
observe("reduce without a first value: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })), 0].reduce(iterates13));
observe("reduce without a first value: a subclass", () => [(Odd.of(5, 6)), 0].reduce(iterates13));
observe("reduce without a first value: an array again", () => [([5, 6]), 0].reduce(iterates13));

iterates14([5, 6]);
iterates14([5, 6]);
observe("reduceRight: an array", () => [0].reduceRight(iterates14, ([5, 6])));
observe("reduceRight: an array-like", () => [0].reduceRight(iterates14, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
observe("reduceRight: a subclass", () => [0].reduceRight(iterates14, (Odd.of(5, 6))));
observe("reduceRight: an array again", () => [0].reduceRight(iterates14, ([5, 6])));

iterates15([5, 6]);
iterates15([5, 6]);
observe("Array.from of an array: an array", () => Array.from([([5, 6])], iterates15));
observe("Array.from of an array: an array-like", () => Array.from([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))], iterates15));
observe("Array.from of an array: a subclass", () => Array.from([(Odd.of(5, 6))], iterates15));
observe("Array.from of an array: an array again", () => Array.from([([5, 6])], iterates15));

iterates16([5, 6]);
iterates16([5, 6]);
observe("Array.from of an array-like: an array", () => Array.from({ length: 1, 0: ([5, 6]) }, iterates16));
observe("Array.from of an array-like: an array-like", () => Array.from({ length: 1, 0: (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })) }, iterates16));
observe("Array.from of an array-like: a subclass", () => Array.from({ length: 1, 0: (Odd.of(5, 6)) }, iterates16));
observe("Array.from of an array-like: an array again", () => Array.from({ length: 1, 0: ([5, 6]) }, iterates16));

iterates17([5, 6]);
iterates17([5, 6]);
observe("Array.from of a set: an array", () => Array.from(new Set([([5, 6])]), iterates17));
observe("Array.from of a set: an array-like", () => Array.from(new Set([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]), iterates17));
observe("Array.from of a set: a subclass", () => Array.from(new Set([(Odd.of(5, 6))]), iterates17));
observe("Array.from of a set: an array again", () => Array.from(new Set([([5, 6])]), iterates17));

iterates18([5, 6]);
iterates18([5, 6]);
observe("forEach of an array-like: an array", () => Array.prototype.forEach.call({ length: 1, 0: ([5, 6]) }, iterates18));
observe("forEach of an array-like: an array-like", () => Array.prototype.forEach.call({ length: 1, 0: (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })) }, iterates18));
observe("forEach of an array-like: a subclass", () => Array.prototype.forEach.call({ length: 1, 0: (Odd.of(5, 6)) }, iterates18));
observe("forEach of an array-like: an array again", () => Array.prototype.forEach.call({ length: 1, 0: ([5, 6]) }, iterates18));

iterates19([5, 6]);
iterates19([5, 6]);
observe("forEach of a set: an array", () => new Set([([5, 6])]).forEach(iterates19));
observe("forEach of a set: an array-like", () => new Set([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]).forEach(iterates19));
observe("forEach of a set: a subclass", () => new Set([(Odd.of(5, 6))]).forEach(iterates19));
observe("forEach of a set: an array again", () => new Set([([5, 6])]).forEach(iterates19));

iterates20([5, 6]);
iterates20([5, 6]);
observe("forEach of a map: an array", () => new Map([[0, ([5, 6])]]).forEach(iterates20));
observe("forEach of a map: an array-like", () => new Map([[0, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]]).forEach(iterates20));
observe("forEach of a map: a subclass", () => new Map([[0, (Odd.of(5, 6))]]).forEach(iterates20));
observe("forEach of a map: an array again", () => new Map([[0, ([5, 6])]]).forEach(iterates20));

iterates21([5, 6]);
iterates21([5, 6]);
observe("map of an iterator: an array", () => [([5, 6])].values().map(iterates21).toArray());
observe("map of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().map(iterates21).toArray());
observe("map of an iterator: a subclass", () => [(Odd.of(5, 6))].values().map(iterates21).toArray());
observe("map of an iterator: an array again", () => [([5, 6])].values().map(iterates21).toArray());

iterates22([5, 6]);
iterates22([5, 6]);
observe("forEach of an iterator: an array", () => [([5, 6])].values().forEach(iterates22));
observe("forEach of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().forEach(iterates22));
observe("forEach of an iterator: a subclass", () => [(Odd.of(5, 6))].values().forEach(iterates22));
observe("forEach of an iterator: an array again", () => [([5, 6])].values().forEach(iterates22));

iterates23([5, 6]);
iterates23([5, 6]);
observe("reduce of an iterator: an array", () => [0].values().reduce(iterates23, ([5, 6])));
observe("reduce of an iterator: an array-like", () => [0].values().reduce(iterates23, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
observe("reduce of an iterator: a subclass", () => [0].values().reduce(iterates23, (Odd.of(5, 6))));
observe("reduce of an iterator: an array again", () => [0].values().reduce(iterates23, ([5, 6])));

iterates24([5, 6]);
iterates24([5, 6]);
observe("filter of an iterator: an array", () => [([5, 6])].values().filter(iterates24).toArray());
observe("filter of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().filter(iterates24).toArray());
observe("filter of an iterator: a subclass", () => [(Odd.of(5, 6))].values().filter(iterates24).toArray());
observe("filter of an iterator: an array again", () => [([5, 6])].values().filter(iterates24).toArray());

iterates25([5, 6]);
iterates25([5, 6]);
observe("find of an iterator: an array", () => [([5, 6])].values().find(iterates25));
observe("find of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().find(iterates25));
observe("find of an iterator: a subclass", () => [(Odd.of(5, 6))].values().find(iterates25));
observe("find of an iterator: an array again", () => [([5, 6])].values().find(iterates25));

iterates26([5, 6]);
iterates26([5, 6]);
observe("some of an iterator: an array", () => [([5, 6])].values().some(iterates26));
observe("some of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().some(iterates26));
observe("some of an iterator: a subclass", () => [(Odd.of(5, 6))].values().some(iterates26));
observe("some of an iterator: an array again", () => [([5, 6])].values().some(iterates26));

iterates27([5, 6]);
iterates27([5, 6]);
observe("every of an iterator: an array", () => [([5, 6])].values().every(iterates27));
observe("every of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().every(iterates27));
observe("every of an iterator: a subclass", () => [(Odd.of(5, 6))].values().every(iterates27));
observe("every of an iterator: an array again", () => [([5, 6])].values().every(iterates27));

iterates28([5, 6]);
iterates28([5, 6]);
observe("findLastIndex: an array", () => [([5, 6])].findLastIndex(iterates28));
observe("findLastIndex: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].findLastIndex(iterates28));
observe("findLastIndex: a subclass", () => [(Odd.of(5, 6))].findLastIndex(iterates28));
observe("findLastIndex: an array again", () => [([5, 6])].findLastIndex(iterates28));

iterates29([5, 6]);
iterates29([5, 6]);
observe("a typed array made from a list: an array", () => Uint8Array.from([([5, 6])], iterates29));
observe("a typed array made from a list: an array-like", () => Uint8Array.from([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))], iterates29));
observe("a typed array made from a list: a subclass", () => Uint8Array.from([(Odd.of(5, 6))], iterates29));
observe("a typed array made from a list: an array again", () => Uint8Array.from([([5, 6])], iterates29));

iterates30([5, 6]);
iterates30([5, 6]);
observe("adopt of a disposable stack: an array", () => (stack => (stack.adopt(([5, 6]), iterates30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an array-like", () => (stack => (stack.adopt((({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })), iterates30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: a subclass", () => (stack => (stack.adopt((Odd.of(5, 6)), iterates30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an array again", () => (stack => (stack.adopt(([5, 6]), iterates30), stack.dispose()))(new DisposableStack()));

iterates31([5, 6]);
iterates31([5, 6]);
observe("getOrInsertComputed of a map: an array", () => new Map().getOrInsertComputed(([5, 6]), iterates31));
observe("getOrInsertComputed of a map: an array-like", () => new Map().getOrInsertComputed((({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })), iterates31));
observe("getOrInsertComputed of a map: a subclass", () => new Map().getOrInsertComputed((Odd.of(5, 6)), iterates31));
observe("getOrInsertComputed of a map: an array again", () => new Map().getOrInsertComputed(([5, 6]), iterates31));

iterates32([5, 6]);
iterates32([5, 6]);
observe("Object.groupBy: an array", () => Object.groupBy([([5, 6])], iterates32));
observe("Object.groupBy: an array-like", () => Object.groupBy([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))], iterates32));
observe("Object.groupBy: a subclass", () => Object.groupBy([(Odd.of(5, 6))], iterates32));
observe("Object.groupBy: an array again", () => Object.groupBy([([5, 6])], iterates32));

iterates33([5, 6]);
iterates33([5, 6]);
observe("Map.groupBy: an array", () => Map.groupBy([([5, 6])], iterates33));
observe("Map.groupBy: an array-like", () => Map.groupBy([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))], iterates33));
observe("Map.groupBy: a subclass", () => Map.groupBy([(Odd.of(5, 6))], iterates33));
observe("Map.groupBy: an array again", () => Map.groupBy([([5, 6])], iterates33));

iterates34([5, 6]);
iterates34([5, 6]);
observe("Reflect.apply: an array", () => Reflect.apply(iterates34, undefined, [([5, 6])]));
observe("Reflect.apply: an array-like", () => Reflect.apply(iterates34, undefined, [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]));
observe("Reflect.apply: a subclass", () => Reflect.apply(iterates34, undefined, [(Odd.of(5, 6))]));
observe("Reflect.apply: an array again", () => Reflect.apply(iterates34, undefined, [([5, 6])]));

iterates35([5, 6]);
iterates35([5, 6]);
observe("Reflect.apply with an array-like: an array", () => Reflect.apply(iterates35, undefined, { length: 1, 0: ([5, 6]) }));
observe("Reflect.apply with an array-like: an array-like", () => Reflect.apply(iterates35, undefined, { length: 1, 0: (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })) }));
observe("Reflect.apply with an array-like: a subclass", () => Reflect.apply(iterates35, undefined, { length: 1, 0: (Odd.of(5, 6)) }));
observe("Reflect.apply with an array-like: an array again", () => Reflect.apply(iterates35, undefined, { length: 1, 0: ([5, 6]) }));

iterates36([5, 6]);
iterates36([5, 6]);
observe("Reflect.construct: an array", () => Reflect.construct(iterates36, [([5, 6])]));
observe("Reflect.construct: an array-like", () => Reflect.construct(iterates36, [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]));
observe("Reflect.construct: a subclass", () => Reflect.construct(iterates36, [(Odd.of(5, 6))]));
observe("Reflect.construct: an array again", () => Reflect.construct(iterates36, [([5, 6])]));

iterates37([5, 6]);
iterates37([5, 6]);
observe("call: an array", () => iterates37.call(undefined, ([5, 6])));
observe("call: an array-like", () => iterates37.call(undefined, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
observe("call: a subclass", () => iterates37.call(undefined, (Odd.of(5, 6))));
observe("call: an array again", () => iterates37.call(undefined, ([5, 6])));

iterates38([5, 6]);
iterates38([5, 6]);
observe("apply: an array", () => iterates38.apply(undefined, [([5, 6])]));
observe("apply: an array-like", () => iterates38.apply(undefined, [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]));
observe("apply: a subclass", () => iterates38.apply(undefined, [(Odd.of(5, 6))]));
observe("apply: an array again", () => iterates38.apply(undefined, [([5, 6])]));

iterates39([5, 6]);
iterates39([5, 6]);
observe("bind: an array", () => iterates39.bind(undefined, ([5, 6]))());
observe("bind: an array-like", () => iterates39.bind(undefined, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })))());
observe("bind: a subclass", () => iterates39.bind(undefined, (Odd.of(5, 6)))());
observe("bind: an array again", () => iterates39.bind(undefined, ([5, 6]))());

iterates40([5, 6]);
iterates40([5, 6]);
observe("a setter: an array", () => Object.defineProperty({}, "key", { set: iterates40 }).key = ([5, 6]));
observe("a setter: an array-like", () => Object.defineProperty({}, "key", { set: iterates40 }).key = (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })));
observe("a setter: a subclass", () => Object.defineProperty({}, "key", { set: iterates40 }).key = (Odd.of(5, 6)));
observe("a setter: an array again", () => Object.defineProperty({}, "key", { set: iterates40 }).key = ([5, 6]));

iterates41([5, 6]);
iterates41([5, 6]);
observe("Symbol.hasInstance: an array", () => ([5, 6]) instanceof { [Symbol.hasInstance]: iterates41 });
observe("Symbol.hasInstance: an array-like", () => (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })) instanceof { [Symbol.hasInstance]: iterates41 });
observe("Symbol.hasInstance: a subclass", () => (Odd.of(5, 6)) instanceof { [Symbol.hasInstance]: iterates41 });
observe("Symbol.hasInstance: an array again", () => ([5, 6]) instanceof { [Symbol.hasInstance]: iterates41 });

iterates42([5, 6]);
iterates42([5, 6]);
observe("the set trap of a proxy: an array", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(iterates42, undefined, [value]), true) }).key = ([5, 6]));
observe("the set trap of a proxy: an array-like", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(iterates42, undefined, [value]), true) }).key = (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })));
observe("the set trap of a proxy: a subclass", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(iterates42, undefined, [value]), true) }).key = (Odd.of(5, 6)));
observe("the set trap of a proxy: an array again", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(iterates42, undefined, [value]), true) }).key = ([5, 6]));

iterates43([5, 6]);
iterates43([5, 6]);
observe("a replacer of JSON.stringify: an array", () => JSON.stringify(0, () => void [([5, 6])].forEach(iterates43)));
observe("a replacer of JSON.stringify: an array-like", () => JSON.stringify(0, () => void [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].forEach(iterates43)));
observe("a replacer of JSON.stringify: a subclass", () => JSON.stringify(0, () => void [(Odd.of(5, 6))].forEach(iterates43)));
observe("a replacer of JSON.stringify: an array again", () => JSON.stringify(0, () => void [([5, 6])].forEach(iterates43)));

iterates44(0, [5, 6]);
iterates44(0, [5, 6]);
observe("a tagged template: an array", () => iterates44.bind(undefined)\`\${([5, 6])}\`);
observe("a tagged template: an array-like", () => iterates44.bind(undefined)\`\${(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))}\`);
observe("a tagged template: a subclass", () => iterates44.bind(undefined)\`\${(Odd.of(5, 6))}\`);
observe("a tagged template: an array again", () => iterates44.bind(undefined)\`\${([5, 6])}\`);

iterates45([5, 6]);
iterates45([5, 6]);
observe("a listener of an event emitter: an array", () => new (require("node:events").EventEmitter)().once("value", iterates45).emit("value", ([5, 6])));
observe("a listener of an event emitter: an array-like", () => new (require("node:events").EventEmitter)().once("value", iterates45).emit("value", (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
observe("a listener of an event emitter: a subclass", () => new (require("node:events").EventEmitter)().once("value", iterates45).emit("value", (Odd.of(5, 6))));
observe("a listener of an event emitter: an array again", () => new (require("node:events").EventEmitter)().once("value", iterates45).emit("value", ([5, 6])));
`,
    ),
    "code-of-an-operand-runs-between-two-reads-objects-and-collections-1.js": text(
      `"use strict";

const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

let shared = "same";
let fire = () => {};

const withMethods = () => ({
  valueOf() {
    fire();
    return 1;
  },
  toString() {
    fire();
    return "1";
  },
  toJSON() {
    fire();
    return 1;
  },
  get length() {
    fire();
    return 1;
  },
  get 0() {
    fire();
    return 1;
  },
  get k() {
    fire();
    return 1;
  },
  get then() {
    fire();
    return undefined;
  },
  [Symbol.iterator]() {
    fire();
    return [[1, 1]][Symbol.iterator]();
  },
});
const traps = new Proxy({}, {
  get: (handler, trap) => (...list) => {
    fire();
    return Reflect[trap](...list);
  },
});
const trapped = () => new Proxy({}, traps);
const trappedFunction = () => new Proxy(function () {}, traps);

function observe(label, use, operand) {
  const o = { x: 1, y: "same" };
  const a = ["same", 2];
  shared = "same";
  let fired = 0;
  fire = () => {
    fired++;
    o.y = "changed";
    a[0] = "changed";
    shared = "changed";
  };
  const line = outcome(() => use(o, a, operand()));
  fire = () => {};
  console.log(label + " -> " + line + ", ran " + fired + " times, now " + [o.y, a[0], shared].join(" "));`,
      [
        `keys(t	.values(t
entries(t	.assign({}, t
assign(t, { k: 1 }	.getOwnPropertyNames(t
getOwnPropertySymbols(t	.getOwnPropertyDescriptor(t, "k"
getOwnPropertyDescriptor({}, t	.getOwnPropertyDescriptors(t
defineProperty({}, "k", t	.defineProperty({}, t, {}
defineProperty(t, "k", {}	.defineProperties({}, t
defineProperties({}, { k: t }	.create(t
create(null, t	.create(null, { k: t }
freeze(t	.seal(t
preventExtensions(t	.isFrozen(t
isSealed(t	.isExtensible(t
getPrototypeOf(t	.setPrototypeOf(t, null
setPrototypeOf({}, t	.fromEntries(t
fromEntries([[t, 1]]	.fromEntries([t]
hasOwn(t, "k"	.hasOwn({}, t
is(t, 1	.groupBy(t, x => x
groupBy([1], () => t	(t
prototype.hasOwnProperty.call({}, t	.prototype.hasOwnProperty.call(t, "k"
prototype.toString.call(t	.prototype.toLocaleString.call(t`,
        (n, a, b) => `}

function around${2 * n + 1}(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.${a}));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around${2 * n + 2}(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object${b}));
  return before + " / " + [o.y, a[0], shared].join(" ");`,
      ],
      `}

console.log("strict:", (function () { return this === undefined; })());
observe("Object.keys(t)" + " with a number", around1, () => 1);
observe("Object.keys(t)" + " with methods", around1, withMethods);
observe("Object.keys(t)" + " with a proxy", around1, trapped);
observe("Object.keys(t)" + " with a proxy of a function", around1, trappedFunction);
observe("Object.values(t)" + " with a number", around2, () => 1);
observe("Object.values(t)" + " with methods", around2, withMethods);
observe("Object.values(t)" + " with a proxy", around2, trapped);
observe("Object.values(t)" + " with a proxy of a function", around2, trappedFunction);
observe("Object.entries(t)" + " with a number", around3, () => 1);
observe("Object.entries(t)" + " with methods", around3, withMethods);
observe("Object.entries(t)" + " with a proxy", around3, trapped);
observe("Object.entries(t)" + " with a proxy of a function", around3, trappedFunction);
observe("Object.assign({}, t)" + " with a number", around4, () => 1);
observe("Object.assign({}, t)" + " with methods", around4, withMethods);
observe("Object.assign({}, t)" + " with a proxy", around4, trapped);
observe("Object.assign({}, t)" + " with a proxy of a function", around4, trappedFunction);
observe("Object.assign(t, { k: 1 })" + " with a number", around5, () => 1);
observe("Object.assign(t, { k: 1 })" + " with methods", around5, withMethods);
observe("Object.assign(t, { k: 1 })" + " with a proxy", around5, trapped);
observe("Object.assign(t, { k: 1 })" + " with a proxy of a function", around5, trappedFunction);
observe("Object.getOwnPropertyNames(t)" + " with a number", around6, () => 1);
observe("Object.getOwnPropertyNames(t)" + " with methods", around6, withMethods);
observe("Object.getOwnPropertyNames(t)" + " with a proxy", around6, trapped);
observe("Object.getOwnPropertyNames(t)" + " with a proxy of a function", around6, trappedFunction);
observe("Object.getOwnPropertySymbols(t)" + " with a number", around7, () => 1);
observe("Object.getOwnPropertySymbols(t)" + " with methods", around7, withMethods);
observe("Object.getOwnPropertySymbols(t)" + " with a proxy", around7, trapped);
observe("Object.getOwnPropertySymbols(t)" + " with a proxy of a function", around7, trappedFunction);
observe("Object.getOwnPropertyDescriptor(t, \\"k\\")" + " with a number", around8, () => 1);
observe("Object.getOwnPropertyDescriptor(t, \\"k\\")" + " with methods", around8, withMethods);
observe("Object.getOwnPropertyDescriptor(t, \\"k\\")" + " with a proxy", around8, trapped);
observe("Object.getOwnPropertyDescriptor(t, \\"k\\")" + " with a proxy of a function", around8, trappedFunction);
observe("Object.getOwnPropertyDescriptor({}, t)" + " with a number", around9, () => 1);
observe("Object.getOwnPropertyDescriptor({}, t)" + " with methods", around9, withMethods);
observe("Object.getOwnPropertyDescriptor({}, t)" + " with a proxy", around9, trapped);
observe("Object.getOwnPropertyDescriptor({}, t)" + " with a proxy of a function", around9, trappedFunction);
observe("Object.getOwnPropertyDescriptors(t)" + " with a number", around10, () => 1);
observe("Object.getOwnPropertyDescriptors(t)" + " with methods", around10, withMethods);
observe("Object.getOwnPropertyDescriptors(t)" + " with a proxy", around10, trapped);
observe("Object.getOwnPropertyDescriptors(t)" + " with a proxy of a function", around10, trappedFunction);
observe("Object.defineProperty({}, \\"k\\", t)" + " with a number", around11, () => 1);
observe("Object.defineProperty({}, \\"k\\", t)" + " with methods", around11, withMethods);
observe("Object.defineProperty({}, \\"k\\", t)" + " with a proxy", around11, trapped);
observe("Object.defineProperty({}, \\"k\\", t)" + " with a proxy of a function", around11, trappedFunction);
observe("Object.defineProperty({}, t, {})" + " with a number", around12, () => 1);
observe("Object.defineProperty({}, t, {})" + " with methods", around12, withMethods);
observe("Object.defineProperty({}, t, {})" + " with a proxy", around12, trapped);
observe("Object.defineProperty({}, t, {})" + " with a proxy of a function", around12, trappedFunction);
observe("Object.defineProperty(t, \\"k\\", {})" + " with a number", around13, () => 1);
observe("Object.defineProperty(t, \\"k\\", {})" + " with methods", around13, withMethods);
observe("Object.defineProperty(t, \\"k\\", {})" + " with a proxy", around13, trapped);
observe("Object.defineProperty(t, \\"k\\", {})" + " with a proxy of a function", around13, trappedFunction);
observe("Object.defineProperties({}, t)" + " with a number", around14, () => 1);
observe("Object.defineProperties({}, t)" + " with methods", around14, withMethods);
observe("Object.defineProperties({}, t)" + " with a proxy", around14, trapped);
observe("Object.defineProperties({}, t)" + " with a proxy of a function", around14, trappedFunction);
observe("Object.defineProperties({}, { k: t })" + " with a number", around15, () => 1);
observe("Object.defineProperties({}, { k: t })" + " with methods", around15, withMethods);
observe("Object.defineProperties({}, { k: t })" + " with a proxy", around15, trapped);
observe("Object.defineProperties({}, { k: t })" + " with a proxy of a function", around15, trappedFunction);
observe("Object.create(t)" + " with a number", around16, () => 1);
observe("Object.create(t)" + " with methods", around16, withMethods);
observe("Object.create(t)" + " with a proxy", around16, trapped);
observe("Object.create(t)" + " with a proxy of a function", around16, trappedFunction);
observe("Object.create(null, t)" + " with a number", around17, () => 1);
observe("Object.create(null, t)" + " with methods", around17, withMethods);
observe("Object.create(null, t)" + " with a proxy", around17, trapped);
observe("Object.create(null, t)" + " with a proxy of a function", around17, trappedFunction);
observe("Object.create(null, { k: t })" + " with a number", around18, () => 1);
observe("Object.create(null, { k: t })" + " with methods", around18, withMethods);
observe("Object.create(null, { k: t })" + " with a proxy", around18, trapped);
observe("Object.create(null, { k: t })" + " with a proxy of a function", around18, trappedFunction);
observe("Object.freeze(t)" + " with a number", around19, () => 1);
observe("Object.freeze(t)" + " with methods", around19, withMethods);
observe("Object.freeze(t)" + " with a proxy", around19, trapped);
observe("Object.freeze(t)" + " with a proxy of a function", around19, trappedFunction);
observe("Object.seal(t)" + " with a number", around20, () => 1);
observe("Object.seal(t)" + " with methods", around20, withMethods);
observe("Object.seal(t)" + " with a proxy", around20, trapped);
observe("Object.seal(t)" + " with a proxy of a function", around20, trappedFunction);
observe("Object.preventExtensions(t)" + " with a number", around21, () => 1);
observe("Object.preventExtensions(t)" + " with methods", around21, withMethods);
observe("Object.preventExtensions(t)" + " with a proxy", around21, trapped);
observe("Object.preventExtensions(t)" + " with a proxy of a function", around21, trappedFunction);
observe("Object.isFrozen(t)" + " with a number", around22, () => 1);
observe("Object.isFrozen(t)" + " with methods", around22, withMethods);
observe("Object.isFrozen(t)" + " with a proxy", around22, trapped);
observe("Object.isFrozen(t)" + " with a proxy of a function", around22, trappedFunction);
observe("Object.isSealed(t)" + " with a number", around23, () => 1);
observe("Object.isSealed(t)" + " with methods", around23, withMethods);
observe("Object.isSealed(t)" + " with a proxy", around23, trapped);
observe("Object.isSealed(t)" + " with a proxy of a function", around23, trappedFunction);
observe("Object.isExtensible(t)" + " with a number", around24, () => 1);
observe("Object.isExtensible(t)" + " with methods", around24, withMethods);
observe("Object.isExtensible(t)" + " with a proxy", around24, trapped);
observe("Object.isExtensible(t)" + " with a proxy of a function", around24, trappedFunction);
observe("Object.getPrototypeOf(t)" + " with a number", around25, () => 1);
observe("Object.getPrototypeOf(t)" + " with methods", around25, withMethods);
observe("Object.getPrototypeOf(t)" + " with a proxy", around25, trapped);
observe("Object.getPrototypeOf(t)" + " with a proxy of a function", around25, trappedFunction);
observe("Object.setPrototypeOf(t, null)" + " with a number", around26, () => 1);
observe("Object.setPrototypeOf(t, null)" + " with methods", around26, withMethods);
observe("Object.setPrototypeOf(t, null)" + " with a proxy", around26, trapped);
observe("Object.setPrototypeOf(t, null)" + " with a proxy of a function", around26, trappedFunction);
observe("Object.setPrototypeOf({}, t)" + " with a number", around27, () => 1);
observe("Object.setPrototypeOf({}, t)" + " with methods", around27, withMethods);
observe("Object.setPrototypeOf({}, t)" + " with a proxy", around27, trapped);
observe("Object.setPrototypeOf({}, t)" + " with a proxy of a function", around27, trappedFunction);
observe("Object.fromEntries(t)" + " with a number", around28, () => 1);
observe("Object.fromEntries(t)" + " with methods", around28, withMethods);
observe("Object.fromEntries(t)" + " with a proxy", around28, trapped);
observe("Object.fromEntries(t)" + " with a proxy of a function", around28, trappedFunction);
observe("Object.fromEntries([[t, 1]])" + " with a number", around29, () => 1);
observe("Object.fromEntries([[t, 1]])" + " with methods", around29, withMethods);
observe("Object.fromEntries([[t, 1]])" + " with a proxy", around29, trapped);
observe("Object.fromEntries([[t, 1]])" + " with a proxy of a function", around29, trappedFunction);
observe("Object.fromEntries([t])" + " with a number", around30, () => 1);
observe("Object.fromEntries([t])" + " with methods", around30, withMethods);
observe("Object.fromEntries([t])" + " with a proxy", around30, trapped);
observe("Object.fromEntries([t])" + " with a proxy of a function", around30, trappedFunction);
observe("Object.hasOwn(t, \\"k\\")" + " with a number", around31, () => 1);
observe("Object.hasOwn(t, \\"k\\")" + " with methods", around31, withMethods);
observe("Object.hasOwn(t, \\"k\\")" + " with a proxy", around31, trapped);
observe("Object.hasOwn(t, \\"k\\")" + " with a proxy of a function", around31, trappedFunction);
observe("Object.hasOwn({}, t)" + " with a number", around32, () => 1);
observe("Object.hasOwn({}, t)" + " with methods", around32, withMethods);
observe("Object.hasOwn({}, t)" + " with a proxy", around32, trapped);
observe("Object.hasOwn({}, t)" + " with a proxy of a function", around32, trappedFunction);
observe("Object.is(t, 1)" + " with a number", around33, () => 1);
observe("Object.is(t, 1)" + " with methods", around33, withMethods);
observe("Object.is(t, 1)" + " with a proxy", around33, trapped);
observe("Object.is(t, 1)" + " with a proxy of a function", around33, trappedFunction);
observe("Object.groupBy(t, x => x)" + " with a number", around34, () => 1);
observe("Object.groupBy(t, x => x)" + " with methods", around34, withMethods);
observe("Object.groupBy(t, x => x)" + " with a proxy", around34, trapped);
observe("Object.groupBy(t, x => x)" + " with a proxy of a function", around34, trappedFunction);
observe("Object.groupBy([1], () => t)" + " with a number", around35, () => 1);
observe("Object.groupBy([1], () => t)" + " with methods", around35, withMethods);
observe("Object.groupBy([1], () => t)" + " with a proxy", around35, trapped);
observe("Object.groupBy([1], () => t)" + " with a proxy of a function", around35, trappedFunction);
observe("Object(t)" + " with a number", around36, () => 1);
observe("Object(t)" + " with methods", around36, withMethods);
observe("Object(t)" + " with a proxy", around36, trapped);
observe("Object(t)" + " with a proxy of a function", around36, trappedFunction);
observe("Object.prototype.hasOwnProperty.call({}, t)" + " with a number", around37, () => 1);
observe("Object.prototype.hasOwnProperty.call({}, t)" + " with methods", around37, withMethods);
observe("Object.prototype.hasOwnProperty.call({}, t)" + " with a proxy", around37, trapped);
observe("Object.prototype.hasOwnProperty.call({}, t)" + " with a proxy of a function", around37, trappedFunction);
observe("Object.prototype.hasOwnProperty.call(t, \\"k\\")" + " with a number", around38, () => 1);
observe("Object.prototype.hasOwnProperty.call(t, \\"k\\")" + " with methods", around38, withMethods);
observe("Object.prototype.hasOwnProperty.call(t, \\"k\\")" + " with a proxy", around38, trapped);
observe("Object.prototype.hasOwnProperty.call(t, \\"k\\")" + " with a proxy of a function", around38, trappedFunction);
observe("Object.prototype.toString.call(t)" + " with a number", around39, () => 1);
observe("Object.prototype.toString.call(t)" + " with methods", around39, withMethods);
observe("Object.prototype.toString.call(t)" + " with a proxy", around39, trapped);
observe("Object.prototype.toString.call(t)" + " with a proxy of a function", around39, trappedFunction);
observe("Object.prototype.toLocaleString.call(t)" + " with a number", around40, () => 1);
observe("Object.prototype.toLocaleString.call(t)" + " with methods", around40, withMethods);
observe("Object.prototype.toLocaleString.call(t)" + " with a proxy", around40, trapped);
observe("Object.prototype.toLocaleString.call(t)" + " with a proxy of a function", around40, trappedFunction);
`,
    ),
    "each-class-is-closed-by-one-roundabout-route.js": text(
      `function show(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

const { freeze: pulledOut } = Object;
const Renamed = Object;
const flag = JSON.parse("true");
const tools = { close: Object.freeze };

function callWith(callee, input) {
  return callee(input);
}

function pick() {
  return Object.freeze;`,
      [
        `PlainCall
ForEach
Map
Some
ArrayFrom
SetForEach
Values
Then
Call
Apply
Bind`,
        (n, a) => `}

class By${a} {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }`,
      ],
      `}

class ByReflectApply {`,
      [
        `Pattern
Brackets
JoinedName
OtherName
Condition
Member
Parameter
Result
Holder
Seal`,
        (n, a) => `  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class By${a} {`,
      ],
      `  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByPreventExtensions {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByReflectPreventExtensions {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

const rows = [
  ["Object.freeze(box)", () => new ByPlainCall(), box => Object.freeze(box)],
  ["[box].forEach(Object.freeze)", () => new ByForEach(), box => [box].forEach(Object.freeze)],
  ["[box].map(Object.freeze)", () => new ByMap(), box => [box].map(Object.freeze)],
  ["[box].some(Object.freeze)", () => new BySome(), box => [box].some(Object.freeze)],
  ["Array.from([box], Object.freeze)", () => new ByArrayFrom(), box => Array.from([box], Object.freeze)],
  ["new Set([box]).forEach(Object.freeze)", () => new BySetForEach(), box => new Set([box]).forEach(Object.freeze)],
  ["Object.values({ box }).forEach(Object.freeze)", () => new ByValues(), box => Object.values({ box }).forEach(Object.freeze)],
  ["Promise.resolve(box).then(Object.freeze)", () => new ByThen(), box => Promise.resolve(box).then(Object.freeze)],
  ["Object.freeze.call(null, box)", () => new ByCall(), box => Object.freeze.call(null, box)],
  ["Object.freeze.apply(null, [box])", () => new ByApply(), box => Object.freeze.apply(null, [box])],
  ["Object.freeze.bind(null, box)()", () => new ByBind(), box => Object.freeze.bind(null, box)()],
  ["Reflect.apply(Object.freeze, null, [box])", () => new ByReflectApply(), box => Reflect.apply(Object.freeze, null, [box])],
  ["const { freeze } = Object; freeze(box)", () => new ByPattern(), box => pulledOut(box)],
  ["Object[\\"freeze\\"](box)", () => new ByBrackets(), box => Object["freeze"](box)],
  ["Object[joined name](box)", () => new ByJoinedName(), box => Object[["fre", "eze"].join("")](box)],
  ["const Renamed = Object; Renamed.freeze(box)", () => new ByOtherName(), box => Renamed.freeze(box)],
  ["(flag ? Object.freeze : Object.seal)(box)", () => new ByCondition(), box => (flag ? Object.freeze : Object.seal)(box)],
  ["tools.close(box), where close is Object.freeze", () => new ByMember(), box => tools.close(box)],
  ["a function that calls its parameter", () => new ByParameter(), box => callWith(Object.freeze, box)],
  ["a function that returns Object.freeze", () => new ByResult(), box => pick()(box)],
  ["Object.freeze(holder.box)", () => new ByHolder(), box => Object.freeze({ box }.box)],
  ["[box].forEach(Object.seal)", () => new BySeal(), box => [box].forEach(Object.seal)],
  ["[box].forEach(Object.preventExtensions)", () => new ByPreventExtensions(), box => [box].forEach(Object.preventExtensions)],
  ["[box].forEach(Reflect.preventExtensions)", () => new ByReflectPreventExtensions(), box => [box].forEach(each => Reflect.preventExtensions(each))],
];

function look(box) {
  const steps = [() => box.width, () => box.area(), () => box.store(5), () => box.add(), () => box.drop(), () => Object.keys(box).join()];
  return steps
    .map(step => {
      try {
        return show(step());
      } catch (error) {
        return error.constructor.name;
      }
    })
    .join(" ");
}

for (let i = 0; i < 2000; i++) {
  for (const [, make] of rows) {
    const box = make();
    box.store(i % 7);
    box.add();
    box.drop();
    box.area();
  }
}

for (const [label, make, change] of rows) {
  console.log(label + " | untouched -> " + look(make()));
  const box = make();
  let line = label + " | changed -> ";
  try {
    await change(box);
    line += look(box);
  } catch (error) {
    line += "the change threw " + error.constructor.name;
  }
  console.log(line);
}
`,
    ),
    "values-that-only-look-like-a-function-are-used-in-loops-with-a-try.js": text(
      `import vm from "node:vm";

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];
const atFirst = new Map();
let same = 0;

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  if (log.length) line += ", log " + log.join(" ");
  if (!atFirst.has(label)) console.log(label + ":", line);
  else if (atFirst.get(label) === line) same++;
  else console.log("changed, " + label + ":", line);
  atFirst.set(label, line);`,
      [
        `callIt	f
callItIfThere	f?.
buildIt	new f`,
        (n, a, b) => `}

function ${a}(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(${b}(1, 2));
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;`,
      ],
      `}

function callItAsAMethod(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      const holder = { name: "holder", f };`,
      [
        `holder.f(1, 2)	handItToMap
[1, 2].map(f)	throughCall
f.call("self", 1, 2)	throughApply
f.apply("self", [1, 2])	throughBind
f.bind("self", 1)(2)	throughReflect
Reflect.apply(f, "self", [1, 2])	tagWithIt
f\`a\${1}b\`	testAnInstance
{} instanceof f	lengthOf
f.length	nameOf
f.name	prototypeOf
typeof f.prototype	kindOf`,
        (n, a, b) => `      out.push(${a});
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function ${b}(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {`,
      ],
      `      out.push(typeof f);
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function plus(a, b) {
  return a + b;
}

function minus(a, b) {
  return a - b;
}

function first(a) {
  return a;
}

function honest(round) {
  console.log(round, "callIt", show(callIt(plus)), show(callIt(minus)), show(callIt(first)), show(callIt(function (a, b) { return [a, b]; })));
  console.log(round, "callItIfThere", show(callItIfThere(plus)), show(callItIfThere(minus)), show(callItIfThere(first)), show(callItIfThere(function (a, b) { return [a, b]; })));
  console.log(round, "buildIt", show(buildIt(plus)), show(buildIt(minus)), show(buildIt(first)), show(buildIt(function (a, b) { this.a = a; this.b = b; })));
  console.log(round, "callItAsAMethod", show(callItAsAMethod(plus)), show(callItAsAMethod(minus)), show(callItAsAMethod(first)), show(callItAsAMethod(function () { return this.name; })));
  console.log(round, "handItToMap", show(handItToMap(plus)), show(handItToMap(minus)), show(handItToMap(first)), show(handItToMap(function (a, b) { return [a, b]; })));
  console.log(round, "throughCall", show(throughCall(plus)), show(throughCall(minus)), show(throughCall(first)), show(throughCall(function () { return String(this); })));
  console.log(round, "throughApply", show(throughApply(plus)), show(throughApply(minus)), show(throughApply(first)), show(throughApply(function () { return String(this); })));
  console.log(round, "throughBind", show(throughBind(plus)), show(throughBind(minus)), show(throughBind(first)), show(throughBind(function () { return String(this); })));
  console.log(round, "throughReflect", show(throughReflect(plus)), show(throughReflect(minus)), show(throughReflect(first)), show(throughReflect(function () { return String(this); })));
  console.log(round, "tagWithIt", show(tagWithIt(plus)), show(tagWithIt(minus)), show(tagWithIt(first)), show(tagWithIt(function (strings) { return strings.raw; })));
  console.log(round, "testAnInstance", show(testAnInstance(plus)), show(testAnInstance(minus)), show(testAnInstance(first)), show(testAnInstance(Object)));
  console.log(round, "lengthOf", show(lengthOf(plus)), show(lengthOf(minus)), show(lengthOf(first)), show(lengthOf(function () {})));
  console.log(round, "nameOf", show(nameOf(plus)), show(nameOf(minus)), show(nameOf(first)), show(nameOf(function () {})));
  console.log(round, "prototypeOf", show(prototypeOf(plus)), show(prototypeOf(minus)), show(prototypeOf(first)), show(prototypeOf(function () {})));
  console.log(round, "kindOf", show(kindOf(plus)), show(kindOf(minus)), show(kindOf(first)), show(kindOf(function () {})));
}

const impostors = [
  ["a callable proxy", () => new Proxy(plus, { apply: (target, self, list) => (log.push("apply"), "trapped"), construct: () => (log.push("construct"), {}) })],
  ["a revoked proxy", () => { const { proxy, revoke } = Proxy.revocable(plus, {}); revoke(); return proxy; }],
  ["a bound function", () => plus.bind(null, 10)],
  ["a class", () => class { constructor(a) { this.a = a; } }],
  ["an arrow function", () => (a, b) => a * b],
  ["an async function", () => async (a, b) => a + b],
  ["a generator function", () => function* (a) { yield a; }],
  ["a native function", () => Math.max],
  ["a native constructor", () => String],
  ["an object with call, apply and bind", () => ({ call: () => "its own call", apply: () => "its own apply", bind: () => () => "its own bind" })],
  ["a function with its own call", () => Object.assign(function (a, b) { return a + b; }, { call: () => "its own call" })],
  ["a function without a prototype chain", () => Object.setPrototypeOf(function (a, b) { return a + b; }, null)],
  ["a function of another realm", () => vm.runInNewContext("(function (a, b) { return a + b; })")],
  ["a string", () => "plus"],
  ["undefined", () => undefined],
];

function meetTheImpostors() {
  for (const [name, make] of impostors) {
    attempt("callIt, " + name, () => callIt(make()));
    attempt("callItIfThere, " + name, () => callItIfThere(make()));
    attempt("buildIt, " + name, () => buildIt(make()));
    attempt("callItAsAMethod, " + name, () => callItAsAMethod(make()));
    attempt("handItToMap, " + name, () => handItToMap(make()));
    attempt("throughCall, " + name, () => throughCall(make()));
    attempt("throughApply, " + name, () => throughApply(make()));
    attempt("throughBind, " + name, () => throughBind(make()));
    attempt("throughReflect, " + name, () => throughReflect(make()));
    attempt("tagWithIt, " + name, () => tagWithIt(make()));
    attempt("testAnInstance, " + name, () => testAnInstance(make()));
    attempt("lengthOf, " + name, () => lengthOf(make()));
    attempt("nameOf, " + name, () => nameOf(make()));
    attempt("prototypeOf, " + name, () => prototypeOf(make()));
    attempt("kindOf, " + name, () => kindOf(make()));
  }
}

meetTheImpostors();
honest("after the impostors came first");
for (let i = 0; i < 2000; i++) {
  const f = i % 2 ? plus : minus;
  callIt(f);
  callItIfThere(f);
  buildIt(f);
  callItAsAMethod(f);
  handItToMap(f);
  throughCall(f);
  throughApply(f);
  throughBind(f);
  throughReflect(f);
  tagWithIt(f);
  testAnInstance(f);
  lengthOf(f);
  nameOf(f);
  prototypeOf(f);
  kindOf(f);
}
meetTheImpostors();
console.log("the same after 2000 honest calls:", same);
honest("at the end");
`,
    ),
    ...family(
      `many-callers-and-an-impostor-through-a-json-parse-reviver.cjs	keys", () => JSON.parse("[7]", half	keys", () => JSON.parse("[7]", below	keys", () => JSON.parse("[7]", low	keys", () => JSON.parse("[7]", pick	keys", () => JSON.parse("[7]", invoke	keys", () => JSON.parse("[7]", build	keys", () => JSON.parse("[7]", sumOf	keys", () => JSON.parse("[7]", move	keys", () => JSON.parse("[7]", total	keys", () => JSON.parse("[7]", append	keys", () => JSON.parse("[7]", firstCode	keys", () => JSON.parse("[7]", tail
many-callers-and-an-impostor-through-a-promise-executor.cjs	resolving functions", () => void new Promise(half).catch(() => {}	resolving functions", () => void new Promise(below).catch(() => {}	resolving functions", () => void new Promise(low).catch(() => {}	resolving functions", () => void new Promise(pick).catch(() => {}	resolving functions", () => void new Promise(invoke).catch(() => {}	resolving functions", () => void new Promise(build).catch(() => {}	resolving functions", () => void new Promise(sumOf).catch(() => {}	resolving functions", () => void new Promise(move).catch(() => {}	resolving functions", () => void new Promise(total).catch(() => {}	resolving functions", () => void new Promise(append).catch(() => {}	resolving functions", () => void new Promise(firstCode).catch(() => {}	resolving functions", () => void new Promise(tail).catch(() => {}
many-callers-and-an-impostor-through-replace.cjs	match", () => "abc".replace("b", half	match", () => "abc".replace("b", below	match", () => "abc".replace("b", low	match", () => "abc".replace("b", pick	match", () => "abc".replace("b", invoke	match", () => "abc".replace("b", build	match", () => "abc".replace("b", sumOf	match", () => "abc".replace("b", move	match", () => "abc".replace("b", total	match", () => "abc".replace("b", append	match", () => "abc".replace("b", firstCode	match", () => "abc".replace("b", tail`,
      (a, b, c, d, e, f, g, h, i, j, k, l) => `function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

let last;
const log = [];

function attempt(label, run) {
  last = "never set";
  log.length = 0;
  let line;
  try {
    line = "returned " + show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + ", last " + show(last) + (log.length ? ", log " + log.join(" ") : ""));
}

class Stack extends Array {
  push() {
    return "the subclass's push";
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function half(n) {
  return (last = n / 2);
}

function below(n) {
  let steps = 0;
  while (n < 3) {
    n++;
    steps++;
  }
  return (last = steps);
}

const letters = ["a", "b", "c", "d"];

function low(n) {
  return (last = n & 255);
}

function pick(i) {
  return (last = letters[i]);
}

function invoke(f) {
  return (last = f(2));
}

function build(f) {
  return (last = new f(2).value);
}

function sumOf(point) {
  return (last = point.x + point.y);
}

function move(point) {
  point.x = point.x + 1;
  return (last = point.x);
}

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function append(list) {
  return (last = list.push(4));
}

function firstCode(text) {
  return (last = text.charCodeAt(0));
}

function tail(text) {
  return (last = text.slice(1));
}

function honestFirst(round) {
  console.log(round, "half", half(4), half(3), half(0.5), half(-8), half(1e21), half(0));
  console.log(round, "low", low(1), low(256), low(-1), low(1023), low(0), low(65535));
  console.log(round, "invoke", invoke(v => v + 1), invoke(function (v) { return v * 2; }), invoke(v => -v), invoke(v => [v].length), invoke(function same(v) { return v; }), invoke(() => 0));
  console.log(round, "sumOf", sumOf({ x: 1, y: 2 }), sumOf({ x: 3, y: 4 }), sumOf(new Point(5, 6)), sumOf({ x: 0.5, y: 0.5 }), sumOf(new Point(-1, 1)), sumOf({ x: 7, y: 8 }));
  console.log(round, "total", total([1, 2, 3]), total([]), total([0.5, 0.25]), total(new Array(4, 5, 6)), total(Array.of(7, 8)), total([1, 2, 3, 4].slice(1)));
  console.log(round, "firstCode", firstCode("a"), firstCode("bc"), firstCode(""), firstCode("\\u00e9"), firstCode(\`t\${round}\`), firstCode(String(12)));
}

function honestSecond(round) {
  console.log(round, "below", below(0), below(1), below(2.5), below(3), below(-1), below(10));
  console.log(round, "pick", pick(0), pick(1), pick(2), pick(3), pick(1 + 1), pick(letters.length - 1));
  console.log(round, "build", build(class { constructor(v) { this.value = v; } }), build(function (v) { this.value = v * 2; }), build(class { value = 3; }), build(function () {}), build(class extends Point { get value() { return this.x; } }), build(function (v) { return { value: -v }; }));
  console.log(round, "move", move({ x: 1, y: 2 }), move({ x: 3, y: 4 }), move(new Point(5, 6)), move({ x: 0.5, y: 0.5 }), move(new Point(-1, 1)), move({ x: 7, y: 8 }));
  console.log(round, "append", append([1, 2, 3]), append([]), append(new Array(1, 2)), append(["a"]), append([[1], [2]]), append(Array.of(1, 2, 3, 4)));
  console.log(round, "tail", tail("abc"), tail(""), tail("x"), tail(\`t\${round}\`), tail("\\u00e9!"), tail(String(123)));
}

console.log("strict:", (function () { return this === undefined; })());
honestSecond("before");
attempt("half gets the ${a}));
attempt("below gets the ${b}));
attempt("low gets the ${c}));
attempt("pick gets the ${d}));
attempt("invoke gets the ${e}));
attempt("build gets the ${f}));
attempt("sumOf gets the ${g}));
attempt("move gets the ${h}));
attempt("total gets the ${i}));
attempt("append gets the ${j}));
attempt("firstCode gets the ${k}));
attempt("tail gets the ${l}));
honestFirst("after");
honestSecond("after");
`,
    ),
    ...family(
      `many-callers-and-an-impostor-through-a-tagged-template.cjs	the strings of a template", () => invoke\`a\${1}b\`	the strings of a template", () => build\`a\${1}b\`	the strings of a template", () => sumOf\`a\${1}b\`	the strings of a template", () => move\`a\${1}b\`	the strings of a template", () => total\`a\${1}b\`	the strings of a template", () => append\`a\${1}b\`	the strings of a template", () => firstCode\`a\${1}b\`	the strings of a template", () => tail\`a\${1}b\`	the strings of a template", () => half\`a\${1}b\`	the strings of a template", () => below\`a\${1}b\`	the strings of a template", () => low\`a\${1}b\`	the strings of a template", () => pick\`a\${1}b\`
many-callers-and-an-impostor-through-array-from-with-only-a-length.cjs	undefined from an array-like without elements", () => Array.from({ length: 1 }, invoke)[0]	undefined from an array-like without elements", () => Array.from({ length: 1 }, build)[0]	undefined from an array-like without elements", () => Array.from({ length: 1 }, sumOf)[0]	undefined from an array-like without elements", () => Array.from({ length: 1 }, move)[0]	undefined from an array-like without elements", () => Array.from({ length: 1 }, total)[0]	undefined from an array-like without elements", () => Array.from({ length: 1 }, append)[0]	undefined from an array-like without elements", () => Array.from({ length: 1 }, firstCode)[0]	undefined from an array-like without elements", () => Array.from({ length: 1 }, tail)[0]	undefined from an array-like without elements", () => Array.from({ length: 1 }, half)[0]	undefined from an array-like without elements", () => Array.from({ length: 1 }, below)[0]	undefined from an array-like without elements", () => Array.from({ length: 1 }, low)[0]	undefined from an array-like without elements", () => Array.from({ length: 1 }, pick)[0]
many-callers-and-an-impostor-through-to-json.cjs	the key", () => JSON.stringify({ inner: { toJSON: invoke } })	the key", () => JSON.stringify({ inner: { toJSON: build } })	the key", () => JSON.stringify({ inner: { toJSON: sumOf } })	the key", () => JSON.stringify({ inner: { toJSON: move } })	the key", () => JSON.stringify({ inner: { toJSON: total } })	the key", () => JSON.stringify({ inner: { toJSON: append } })	the key", () => JSON.stringify({ inner: { toJSON: firstCode } })	the key", () => JSON.stringify({ inner: { toJSON: tail } })	the key", () => JSON.stringify({ inner: { toJSON: half } })	the key", () => JSON.stringify({ inner: { toJSON: below } })	the key", () => JSON.stringify({ inner: { toJSON: low } })	the key", () => JSON.stringify({ inner: { toJSON: pick } })`,
      (a, b, c, d, e, f, g, h, i, j, k, l) => `function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

let last;
const log = [];

function attempt(label, run) {
  last = "never set";
  log.length = 0;
  let line;
  try {
    line = "returned " + show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + ", last " + show(last) + (log.length ? ", log " + log.join(" ") : ""));
}

class Stack extends Array {
  push() {
    return "the subclass's push";
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function invoke(f) {
  return (last = f(2));
}

function build(f) {
  return (last = new f(2).value);
}

function sumOf(point) {
  return (last = point.x + point.y);
}

function move(point) {
  point.x = point.x + 1;
  return (last = point.x);
}

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function append(list) {
  return (last = list.push(4));
}

function firstCode(text) {
  return (last = text.charCodeAt(0));
}

function tail(text) {
  return (last = text.slice(1));
}

function half(n) {
  return (last = n / 2);
}

function below(n) {
  let steps = 0;
  while (n < 3) {
    n++;
    steps++;
  }
  return (last = steps);
}

const letters = ["a", "b", "c", "d"];

function low(n) {
  return (last = n & 255);
}

function pick(i) {
  return (last = letters[i]);
}

function honestFirst(round) {
  console.log(round, "invoke", invoke(v => v + 1), invoke(function (v) { return v * 2; }), invoke(v => -v), invoke(v => [v].length), invoke(function same(v) { return v; }), invoke(() => 0));
  console.log(round, "sumOf", sumOf({ x: 1, y: 2 }), sumOf({ x: 3, y: 4 }), sumOf(new Point(5, 6)), sumOf({ x: 0.5, y: 0.5 }), sumOf(new Point(-1, 1)), sumOf({ x: 7, y: 8 }));
  console.log(round, "total", total([1, 2, 3]), total([]), total([0.5, 0.25]), total(new Array(4, 5, 6)), total(Array.of(7, 8)), total([1, 2, 3, 4].slice(1)));
  console.log(round, "firstCode", firstCode("a"), firstCode("bc"), firstCode(""), firstCode("\\u00e9"), firstCode(\`t\${round}\`), firstCode(String(12)));
  console.log(round, "half", half(4), half(3), half(0.5), half(-8), half(1e21), half(0));
  console.log(round, "low", low(1), low(256), low(-1), low(1023), low(0), low(65535));
}

function honestSecond(round) {
  console.log(round, "build", build(class { constructor(v) { this.value = v; } }), build(function (v) { this.value = v * 2; }), build(class { value = 3; }), build(function () {}), build(class extends Point { get value() { return this.x; } }), build(function (v) { return { value: -v }; }));
  console.log(round, "move", move({ x: 1, y: 2 }), move({ x: 3, y: 4 }), move(new Point(5, 6)), move({ x: 0.5, y: 0.5 }), move(new Point(-1, 1)), move({ x: 7, y: 8 }));
  console.log(round, "append", append([1, 2, 3]), append([]), append(new Array(1, 2)), append(["a"]), append([[1], [2]]), append(Array.of(1, 2, 3, 4)));
  console.log(round, "tail", tail("abc"), tail(""), tail("x"), tail(\`t\${round}\`), tail("\\u00e9!"), tail(String(123)));
  console.log(round, "below", below(0), below(1), below(2.5), below(3), below(-1), below(10));
  console.log(round, "pick", pick(0), pick(1), pick(2), pick(3), pick(1 + 1), pick(letters.length - 1));
}

console.log("strict:", (function () { return this === undefined; })());
honestSecond("before");
attempt("invoke gets ${a});
attempt("build gets ${b});
attempt("sumOf gets ${c});
attempt("move gets ${d});
attempt("total gets ${e});
attempt("append gets ${f});
attempt("firstCode gets ${g});
attempt("tail gets ${h});
attempt("half gets ${i});
attempt("below gets ${j});
attempt("low gets ${k});
attempt("pick gets ${l});
honestFirst("after");
honestSecond("after");
`,
    ),
    ...family(
      `a-default-after-two-question-marks-stands-beside-the-value.cjs	other	other ?? ([5, 6])	other ?? ("abc")	other ?? (7)	other ?? (x => x + 1)	other ?? (({ x: 1, y: 2 }))		i % 2 ? undefined : 
a-rest-parameter-hands-over-the-value.cjs	...rest	rest[rest.length - 1]	rest[rest.length - 1]	rest[rest.length - 1]	rest[rest.length - 1]	rest[rest.length - 1]	0, 	0, 
a-reviver-of-json-parse-hands-over-the-value.cjs	given	JSON.parse('{"value":0}', (key, value) => (key === "value" ? given : value)).value	JSON.parse('{"value":0}', (key, value) => (key === "value" ? given : value)).value	JSON.parse('{"value":0}', (key, value) => (key === "value" ? given : value)).value	JSON.parse('{"value":0}', (key, value) => (key === "value" ? given : value)).value	JSON.parse('{"value":0}', (key, value) => (key === "value" ? given : value)).value		
arguments-by-index-hands-over-the-value.cjs		arguments[0]	arguments[0]	arguments[0]	arguments[0]	arguments[0]		
the-detail-of-an-event-hands-over-the-value.cjs	given	new CustomEvent("unknown", { detail: given }).detail	new CustomEvent("unknown", { detail: given }).detail	new CustomEvent("unknown", { detail: given }).detail	new CustomEvent("unknown", { detail: given }).detail	new CustomEvent("unknown", { detail: given }).detail		`,
      (a, b, c, d, e, f, g, h) => `const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

const arrays = [
  ["an array", () => [5, 6]],
  ["a subclass", () => Odd.of(5, 6)],
  ["an array-like", () => ({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })],
  ["a proxy", () => logged([5, 6])],
  ["a frozen array", () => Object.freeze([5, 6])],
  ["a string", () => "ab"],
];

const strings = [
  ["a string", () => "abc"],
  ["an object with charCodeAt", () => ({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })],
  ["a String object with its own charCodeAt", () => Object.assign(new String("xyz"), { charCodeAt: () => -1 })],
  ["an array", () => ["abc"]],
  ["a number", () => 65],
];

const numbers = [
  ["an integer", () => 7],
  ["a string", () => "3"],
  ["an object with valueOf", () => ({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })],
  ["a bigint", () => 10n],
  ["the largest int32", () => 2147483647],
  ["minus zero", () => -0],
  ["undefined", () => undefined],
];

const functions = [
  ["a function", () => x => x + 1],
  ["a class", () => class Made { constructor(x) { log.push("constructed " + x); } }],
  ["a callable proxy", () => logged(x => x + 2)],
  ["a bound function", () => function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first")],
  ["an object with call", () => ({ call() { log.push("call"); return "called"; } })],
];

const objects = [
  ["an object", () => ({ x: 1, y: 2 })],
  ["accessors", () => ({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })],
  ["a proxy", () => logged({ y: 2, x: 1 })],
  ["a frozen object", () => Object.freeze({ x: 5, y: 6 })],
  ["texts in another order", () => ({ y: "2", x: "1" })],
  ["inherited members", () => Object.create({ x: 3, y: 4 })],
];

function pushes(${a}) {
  const a = ${b};
  a.push(1);
  return a.length;
}

function iterates(${a}) {
  const a = ${b};
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}

function readsCharCode(${a}) {
  const s = ${c};
  return s.charCodeAt(0);
}

function truncates(${a}) {
  const n = ${d};
  return n | 0;
}

function addsOne(${a}) {
  const n = ${d};
  return n + 1;
}

function calls(${a}) {
  const f = ${e};
  return f(1);
}

function addsMembers(${a}) {
  const o = ${f};
  return o.x + o.y;
}

function storesMember(${a}) {
  const o = ${f};
  o.x = 1;
  return o;
}

const table = [
  ["pushes", pushes, arrays],
  ["iterates", iterates, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["truncates", truncates, numbers],
  ["addsOne", addsOne, numbers],
  ["calls", calls, functions],
  ["addsMembers", addsMembers, objects],
  ["storesMember", storesMember, objects],
];

function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, make] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use(${g}make()));
  }
}

console.log("strict:", (function () { return this === undefined; })());
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes(${h}[5, 6]);
  iterates(${h}[5, 6]);
  readsCharCode(${h}"abc");
  truncates(${h}7);
  addsOne(${h}7);
  calls(${h}x => x + 1);
  addsMembers(${h}({ x: 1, y: 2 }));
  storesMember(${h}({ x: 1, y: 2 }));
}
everyCase("after 2000");
`,
    ),
    ...family(
      `a-substitution-of-a-tagged-template-hands-over-the-value.cjs	Tag(strings, a	a	given => pushesTag\`before \${given} after\`	given => iteratesTag\`before \${given} after\`	Tag(strings, s		given => readsCharCodeTag\`before \${given} after\`	Tag(strings, n	n	given => truncatesTag\`before \${given} after\`	given => addsOneTag\`before \${given} after\`	Tag(strings, f	f	given => callsTag\`before \${given} after\`	Tag(strings, o	o.x + o	given => addsMembersTag\`before \${given} after\`	o	given => storesMemberTag\`before \${given} after\`
reflect-apply-passes-the-value.cjs	Given(a	a	given => Reflect.apply(pushesGiven, undefined, [given])	given => Reflect.apply(iteratesGiven, undefined, [given])	Given(s		given => Reflect.apply(readsCharCodeGiven, undefined, [given])	Given(n	n	given => Reflect.apply(truncatesGiven, undefined, [given])	given => Reflect.apply(addsOneGiven, undefined, [given])	Given(f	f	given => Reflect.apply(callsGiven, undefined, [given])	Given(o	o.x + o	given => Reflect.apply(addsMembersGiven, undefined, [given])	o	given => Reflect.apply(storesMemberGiven, undefined, [given])
the-value-is-bound-as-an-argument.cjs	Given(a	a	value => pushesGiven.bind(undefined, value)()	value => iteratesGiven.bind(undefined, value)()	Given(s		value => readsCharCodeGiven.bind(undefined, value)()	Given(n	n	value => truncatesGiven.bind(undefined, value)()	value => addsOneGiven.bind(undefined, value)()	Given(f	f	value => callsGiven.bind(undefined, value)()	Given(o	o.x + o	value => addsMembersGiven.bind(undefined, value)()	o	value => storesMemberGiven.bind(undefined, value)()
the-value-is-passed-through-call.cjs	Given(a	a	value => pushesGiven.call(undefined, value)	value => iteratesGiven.call(undefined, value)	Given(s		value => readsCharCodeGiven.call(undefined, value)	Given(n	n	value => truncatesGiven.call(undefined, value)	value => addsOneGiven.call(undefined, value)	Given(f	f	value => callsGiven.call(undefined, value)	Given(o	o.x + o	value => addsMembersGiven.call(undefined, value)	o	value => storesMemberGiven.call(undefined, value)
this-is-the-value-in-sloppy-code.cjs	This(	this	given => pushesThis.call(given)	given => iteratesThis.call(given)	This(	thi	given => readsCharCodeThis.call(given)	This(	this	given => truncatesThis.call(given)	given => addsOneThis.call(given)	This(	this	given => callsThis.call(given)	This(	this.x + this	given => addsMembersThis.call(given)	this	given => storesMemberThis.call(given)`,
      (a, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r, s, t) => `const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

const arrays = [
  ["an array", () => [5, 6]],
  ["a subclass", () => Odd.of(5, 6)],
  ["an array-like", () => ({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })],
  ["a proxy", () => logged([5, 6])],
  ["a frozen array", () => Object.freeze([5, 6])],
  ["a string", () => "ab"],
];

const strings = [
  ["a string", () => "abc"],
  ["an object with charCodeAt", () => ({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })],
  ["a String object with its own charCodeAt", () => Object.assign(new String("xyz"), { charCodeAt: () => -1 })],
  ["an array", () => ["abc"]],
  ["a number", () => 65],
];

const numbers = [
  ["an integer", () => 7],
  ["a string", () => "3"],
  ["an object with valueOf", () => ({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })],
  ["a bigint", () => 10n],
  ["the largest int32", () => 2147483647],
  ["minus zero", () => -0],
  ["undefined", () => undefined],
];

const functions = [
  ["a function", () => x => x + 1],
  ["a class", () => class Made { constructor(x) { log.push("constructed " + x); } }],
  ["a callable proxy", () => logged(x => x + 2)],
  ["a bound function", () => function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first")],
  ["an object with call", () => ({ call() { log.push("call"); return "called"; } })],
];

const objects = [
  ["an object", () => ({ x: 1, y: 2 })],
  ["accessors", () => ({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })],
  ["a proxy", () => logged({ y: 2, x: 1 })],
  ["a frozen object", () => Object.freeze({ x: 5, y: 6 })],
  ["texts in another order", () => ({ y: "2", x: "1" })],
  ["inherited members", () => Object.create({ x: 3, y: 4 })],
];

function pushes${a}) {
  ${b}.push(1);
  return ${b}.length;
}
const pushes = ${c};

function iterates${a}) {
  const seen = [];
  for (const x of ${b}) seen.push(x);
  return seen;
}
const iterates = ${d};

function readsCharCode${e}) {
  return ${f}s.charCodeAt(0);
}
const readsCharCode = ${g};

function truncates${h}) {
  return ${i} | 0;
}
const truncates = ${j};

function addsOne${h}) {
  return ${i} + 1;
}
const addsOne = ${k};

function calls${l}) {
  return ${m}(1);
}
const calls = ${o};

function addsMembers${p}) {
  return ${q}.y;
}
const addsMembers = ${r};

function storesMember${p}) {
  ${s}.x = 1;
  return ${s};
}
const storesMember = ${t};

const table = [
  ["pushes", pushes, arrays],
  ["iterates", iterates, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["truncates", truncates, numbers],
  ["addsOne", addsOne, numbers],
  ["calls", calls, functions],
  ["addsMembers", addsMembers, objects],
  ["storesMember", storesMember, objects],
];

function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, make] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use(make()));
  }
}

console.log("strict:", (function () { return this === undefined; })());
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes([5, 6]);
  iterates([5, 6]);
  readsCharCode("abc");
  truncates(7);
  addsOne(7);
  calls(x => x + 1);
  addsMembers(({ x: 1, y: 2 }));
  storesMember(({ x: 1, y: 2 }));
}
everyCase("after 2000");
`,
    ),
    ...family(
      `many-callers-and-an-impostor-from-a-plain-call.cjs	total(make())	append(make())	total("12")	append({ push: () => "a literal's push" })	firstCode(make())	tail(make())	firstCode([65])	tail([1, 2, 3])	half(make())	below(make())	half("4")	below("1")	low(make())	pick(make())	low(4294967297.5)	pick("length")	invoke(make())	build(make())	invoke(class {})	build(() => {})	sumOf(make())	move(make())	sumOf({ y: 2, x: 1 })	move({ get x() { return 1; }, y: 2 })
many-callers-and-an-impostor-through-a-returned-function.cjs	(() => total)()(make())	(() => append)()(make())	(() => total)()("12")	(() => append)()({ push: () => "a literal's push" })	(() => firstCode)()(make())	(() => tail)()(make())	(() => firstCode)()([65])	(() => tail)()([1, 2, 3])	(() => half)()(make())	(() => below)()(make())	(() => half)()("4")	(() => below)()("1")	(() => low)()(make())	(() => pick)()(make())	(() => low)()(4294967297.5)	(() => pick)()("length")	(() => invoke)()(make())	(() => build)()(make())	(() => invoke)()(class {})	(() => build)()(() => {})	(() => sumOf)()(make())	(() => move)()(make())	(() => sumOf)()({ y: 2, x: 1 })	(() => move)()({ get x() { return 1; }, y: 2 })
many-callers-and-an-impostor-through-a-static-field.cjs	(class { static run = total; }).run(make())	(class { static run = append; }).run(make())	(class { static run = total; }).run("12")	(class { static run = append; }).run({ push: () => "a literal's push" })	(class { static run = firstCode; }).run(make())	(class { static run = tail; }).run(make())	(class { static run = firstCode; }).run([65])	(class { static run = tail; }).run([1, 2, 3])	(class { static run = half; }).run(make())	(class { static run = below; }).run(make())	(class { static run = half; }).run("4")	(class { static run = below; }).run("1")	(class { static run = low; }).run(make())	(class { static run = pick; }).run(make())	(class { static run = low; }).run(4294967297.5)	(class { static run = pick; }).run("length")	(class { static run = invoke; }).run(make())	(class { static run = build; }).run(make())	(class { static run = invoke; }).run(class {})	(class { static run = build; }).run(() => {})	(class { static run = sumOf; }).run(make())	(class { static run = move; }).run(make())	(class { static run = sumOf; }).run({ y: 2, x: 1 })	(class { static run = move; }).run({ get x() { return 1; }, y: 2 })
many-callers-and-an-impostor-through-a-throw.cjs	{ try { throw total; } catch (caught) { return caught(make()); } }	{ try { throw append; } catch (caught) { return caught(make()); } }	{ try { throw total; } catch (caught) { return caught("12"); } }	{ try { throw append; } catch (caught) { return caught({ push: () => "a literal's push" }); } }	{ try { throw firstCode; } catch (caught) { return caught(make()); } }	{ try { throw tail; } catch (caught) { return caught(make()); } }	{ try { throw firstCode; } catch (caught) { return caught([65]); } }	{ try { throw tail; } catch (caught) { return caught([1, 2, 3]); } }	{ try { throw half; } catch (caught) { return caught(make()); } }	{ try { throw below; } catch (caught) { return caught(make()); } }	{ try { throw half; } catch (caught) { return caught("4"); } }	{ try { throw below; } catch (caught) { return caught("1"); } }	{ try { throw low; } catch (caught) { return caught(make()); } }	{ try { throw pick; } catch (caught) { return caught(make()); } }	{ try { throw low; } catch (caught) { return caught(4294967297.5); } }	{ try { throw pick; } catch (caught) { return caught("length"); } }	{ try { throw invoke; } catch (caught) { return caught(make()); } }	{ try { throw build; } catch (caught) { return caught(make()); } }	{ try { throw invoke; } catch (caught) { return caught(class {}); } }	{ try { throw build; } catch (caught) { return caught(() => {}); } }	{ try { throw sumOf; } catch (caught) { return caught(make()); } }	{ try { throw move; } catch (caught) { return caught(make()); } }	{ try { throw sumOf; } catch (caught) { return caught({ y: 2, x: 1 }); } }	{ try { throw move; } catch (caught) { return caught({ get x() { return 1; }, y: 2 }); } }
many-callers-and-an-impostor-through-apply-with-an-array-like.cjs	total.apply(undefined, { length: 1, 0: make() })	append.apply(undefined, { length: 1, 0: make() })	total.apply(undefined, { length: 1, 0: "12" })	append.apply(undefined, { length: 1, 0: { push: () => "a literal's push" } })	firstCode.apply(undefined, { length: 1, 0: make() })	tail.apply(undefined, { length: 1, 0: make() })	firstCode.apply(undefined, { length: 1, 0: [65] })	tail.apply(undefined, { length: 1, 0: [1, 2, 3] })	half.apply(undefined, { length: 1, 0: make() })	below.apply(undefined, { length: 1, 0: make() })	half.apply(undefined, { length: 1, 0: "4" })	below.apply(undefined, { length: 1, 0: "1" })	low.apply(undefined, { length: 1, 0: make() })	pick.apply(undefined, { length: 1, 0: make() })	low.apply(undefined, { length: 1, 0: 4294967297.5 })	pick.apply(undefined, { length: 1, 0: "length" })	invoke.apply(undefined, { length: 1, 0: make() })	build.apply(undefined, { length: 1, 0: make() })	invoke.apply(undefined, { length: 1, 0: class {} })	build.apply(undefined, { length: 1, 0: () => {} })	sumOf.apply(undefined, { length: 1, 0: make() })	move.apply(undefined, { length: 1, 0: make() })	sumOf.apply(undefined, { length: 1, 0: { y: 2, x: 1 } })	move.apply(undefined, { length: 1, 0: { get x() { return 1; }, y: 2 } })
many-callers-and-an-impostor-through-bind-borrowed-with-call.cjs	Function.prototype.bind.call(total, undefined, make())()	Function.prototype.bind.call(append, undefined, make())()	Function.prototype.bind.call(total, undefined, "12")()	Function.prototype.bind.call(append, undefined, { push: () => "a literal's push" })()	Function.prototype.bind.call(firstCode, undefined, make())()	Function.prototype.bind.call(tail, undefined, make())()	Function.prototype.bind.call(firstCode, undefined, [65])()	Function.prototype.bind.call(tail, undefined, [1, 2, 3])()	Function.prototype.bind.call(half, undefined, make())()	Function.prototype.bind.call(below, undefined, make())()	Function.prototype.bind.call(half, undefined, "4")()	Function.prototype.bind.call(below, undefined, "1")()	Function.prototype.bind.call(low, undefined, make())()	Function.prototype.bind.call(pick, undefined, make())()	Function.prototype.bind.call(low, undefined, 4294967297.5)()	Function.prototype.bind.call(pick, undefined, "length")()	Function.prototype.bind.call(invoke, undefined, make())()	Function.prototype.bind.call(build, undefined, make())()	Function.prototype.bind.call(invoke, undefined, class {})()	Function.prototype.bind.call(build, undefined, () => {})()	Function.prototype.bind.call(sumOf, undefined, make())()	Function.prototype.bind.call(move, undefined, make())()	Function.prototype.bind.call(sumOf, undefined, { y: 2, x: 1 })()	Function.prototype.bind.call(move, undefined, { get x() { return 1; }, y: 2 })()
many-callers-and-an-impostor-through-for-each.cjs	[make()].forEach(total)	[make()].forEach(append)	["12"].forEach(total)	[{ push: () => "a literal's push" }].forEach(append)	[make()].forEach(firstCode)	[make()].forEach(tail)	[[65]].forEach(firstCode)	[[1, 2, 3]].forEach(tail)	[make()].forEach(half)	[make()].forEach(below)	["4"].forEach(half)	["1"].forEach(below)	[make()].forEach(low)	[make()].forEach(pick)	[4294967297.5].forEach(low)	["length"].forEach(pick)	[make()].forEach(invoke)	[make()].forEach(build)	[class {}].forEach(invoke)	[() => {}].forEach(build)	[make()].forEach(sumOf)	[make()].forEach(move)	[{ y: 2, x: 1 }].forEach(sumOf)	[{ get x() { return 1; }, y: 2 }].forEach(move)
many-callers-and-an-impostor-through-map-borrowed-for-an-array-like.cjs	Array.prototype.map.call({ length: 1, 0: make() }, total)[0]	Array.prototype.map.call({ length: 1, 0: make() }, append)[0]	Array.prototype.map.call({ length: 1, 0: "12" }, total)[0]	Array.prototype.map.call({ length: 1, 0: { push: () => "a literal's push" } }, append)[0]	Array.prototype.map.call({ length: 1, 0: make() }, firstCode)[0]	Array.prototype.map.call({ length: 1, 0: make() }, tail)[0]	Array.prototype.map.call({ length: 1, 0: [65] }, firstCode)[0]	Array.prototype.map.call({ length: 1, 0: [1, 2, 3] }, tail)[0]	Array.prototype.map.call({ length: 1, 0: make() }, half)[0]	Array.prototype.map.call({ length: 1, 0: make() }, below)[0]	Array.prototype.map.call({ length: 1, 0: "4" }, half)[0]	Array.prototype.map.call({ length: 1, 0: "1" }, below)[0]	Array.prototype.map.call({ length: 1, 0: make() }, low)[0]	Array.prototype.map.call({ length: 1, 0: make() }, pick)[0]	Array.prototype.map.call({ length: 1, 0: 4294967297.5 }, low)[0]	Array.prototype.map.call({ length: 1, 0: "length" }, pick)[0]	Array.prototype.map.call({ length: 1, 0: make() }, invoke)[0]	Array.prototype.map.call({ length: 1, 0: make() }, build)[0]	Array.prototype.map.call({ length: 1, 0: class {} }, invoke)[0]	Array.prototype.map.call({ length: 1, 0: () => {} }, build)[0]	Array.prototype.map.call({ length: 1, 0: make() }, sumOf)[0]	Array.prototype.map.call({ length: 1, 0: make() }, move)[0]	Array.prototype.map.call({ length: 1, 0: { y: 2, x: 1 } }, sumOf)[0]	Array.prototype.map.call({ length: 1, 0: { get x() { return 1; }, y: 2 } }, move)[0]
many-callers-and-an-impostor-through-new-function.cjs	new Function("f", "value", "return f(value)")(total, make())	new Function("f", "value", "return f(value)")(append, make())	new Function("f", "value", "return f(value)")(total, "12")	new Function("f", "value", "return f(value)")(append, { push: () => "a literal's push" })	new Function("f", "value", "return f(value)")(firstCode, make())	new Function("f", "value", "return f(value)")(tail, make())	new Function("f", "value", "return f(value)")(firstCode, [65])	new Function("f", "value", "return f(value)")(tail, [1, 2, 3])	new Function("f", "value", "return f(value)")(half, make())	new Function("f", "value", "return f(value)")(below, make())	new Function("f", "value", "return f(value)")(half, "4")	new Function("f", "value", "return f(value)")(below, "1")	new Function("f", "value", "return f(value)")(low, make())	new Function("f", "value", "return f(value)")(pick, make())	new Function("f", "value", "return f(value)")(low, 4294967297.5)	new Function("f", "value", "return f(value)")(pick, "length")	new Function("f", "value", "return f(value)")(invoke, make())	new Function("f", "value", "return f(value)")(build, make())	new Function("f", "value", "return f(value)")(invoke, class {})	new Function("f", "value", "return f(value)")(build, () => {})	new Function("f", "value", "return f(value)")(sumOf, make())	new Function("f", "value", "return f(value)")(move, make())	new Function("f", "value", "return f(value)")(sumOf, { y: 2, x: 1 })	new Function("f", "value", "return f(value)")(move, { get x() { return 1; }, y: 2 })
many-callers-and-an-impostor-through-reflect-construct.cjs	Reflect.construct(total, [make()])	Reflect.construct(append, [make()])	Reflect.construct(total, ["12"])	Reflect.construct(append, [{ push: () => "a literal's push" }])	Reflect.construct(firstCode, [make()])	Reflect.construct(tail, [make()])	Reflect.construct(firstCode, [[65]])	Reflect.construct(tail, [[1, 2, 3]])	Reflect.construct(half, [make()])	Reflect.construct(below, [make()])	Reflect.construct(half, ["4"])	Reflect.construct(below, ["1"])	Reflect.construct(low, [make()])	Reflect.construct(pick, [make()])	Reflect.construct(low, [4294967297.5])	Reflect.construct(pick, ["length"])	Reflect.construct(invoke, [make()])	Reflect.construct(build, [make()])	Reflect.construct(invoke, [class {}])	Reflect.construct(build, [() => {}])	Reflect.construct(sumOf, [make()])	Reflect.construct(move, [make()])	Reflect.construct(sumOf, [{ y: 2, x: 1 }])	Reflect.construct(move, [{ get x() { return 1; }, y: 2 }])
many-callers-and-an-impostor-through-the-values-of-a-set.cjs	new Set([total]).values().next().value(make())	new Set([append]).values().next().value(make())	new Set([total]).values().next().value("12")	new Set([append]).values().next().value({ push: () => "a literal's push" })	new Set([firstCode]).values().next().value(make())	new Set([tail]).values().next().value(make())	new Set([firstCode]).values().next().value([65])	new Set([tail]).values().next().value([1, 2, 3])	new Set([half]).values().next().value(make())	new Set([below]).values().next().value(make())	new Set([half]).values().next().value("4")	new Set([below]).values().next().value("1")	new Set([low]).values().next().value(make())	new Set([pick]).values().next().value(make())	new Set([low]).values().next().value(4294967297.5)	new Set([pick]).values().next().value("length")	new Set([invoke]).values().next().value(make())	new Set([build]).values().next().value(make())	new Set([invoke]).values().next().value(class {})	new Set([build]).values().next().value(() => {})	new Set([sumOf]).values().next().value(make())	new Set([move]).values().next().value(make())	new Set([sumOf]).values().next().value({ y: 2, x: 1 })	new Set([move]).values().next().value({ get x() { return 1; }, y: 2 })`,
      (a, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r, s, t, u, v, w, x, y) => `function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

let last;
const log = [];

function attempt(label, run) {
  last = "never set";
  log.length = 0;
  let line;
  try {
    line = "returned " + show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + ", last " + show(last) + (log.length ? ", log " + log.join(" ") : ""));
}

class Stack extends Array {
  push() {
    return "the subclass's push";
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function append(list) {
  return (last = list.push(4));
}

function firstCode(text) {
  return (last = text.charCodeAt(0));
}

function tail(text) {
  return (last = text.slice(1));
}

function half(n) {
  return (last = n / 2);
}

function below(n) {
  let steps = 0;
  while (n < 3) {
    n++;
    steps++;
  }
  return (last = steps);
}

const letters = ["a", "b", "c", "d"];

function low(n) {
  return (last = n & 255);
}

function pick(i) {
  return (last = letters[i]);
}

function invoke(f) {
  return (last = f(2));
}

function build(f) {
  return (last = new f(2).value);
}

function sumOf(point) {
  return (last = point.x + point.y);
}

function move(point) {
  point.x = point.x + 1;
  return (last = point.x);
}

const notArrays = [
  ["a string", () => "12"],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a subclass", () => new Stack(1, 2)],
  ["a frozen array", () => Object.freeze([1, 2])],
  ["an array of holes", () => new Array(2)],
  ["parsed JSON", () => JSON.parse('{"0":5,"length":1}')],
  ["null", () => null],
];

const notStrings = [
  ["an array", () => ["a", "b"]],
  ["a String object", () => new String("ab")],
  ["an object with the methods", () => ({ charCodeAt: () => "a code", slice: () => "a slice" })],
  ["a Buffer", () => Buffer.from("ab")],
  ["a number", () => 65],
  ["undefined", () => undefined],
];

const notNumbers = [
  ["a numeric string", () => "1"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 1) })],
  ["an object with Symbol.toPrimitive", () => ({ [Symbol.toPrimitive]: hint => (log.push(hint), 2) })],
  ["a BigInt", () => 1n],
  ["an array of one", () => [1]],
  ["a symbol", () => Symbol("s")],
  ["negative zero", () => -0],
  ["null", () => null],
  ["undefined", () => undefined],
];

const notSmallIntegers = [
  ["two to the 31st", () => 2147483648],
  ["past two to the 32nd", () => 4294967297],
  ["a fraction", () => 1.5],
  ["negative zero", () => -0],
  ["NaN", () => NaN],
  ["a numeric string", () => "1"],
  ["a name", () => "length"],
  ["an object", () => ({ valueOf: () => (log.push("valueOf"), 2), toString: () => (log.push("toString"), "3") })],
  ["a BigInt", () => 1n],
  ["undefined", () => undefined],
];

const notFunctions = [
  ["a class", () => class { constructor(v) { this.value = v; } }],
  ["an arrow function", () => v => ({ value: v })],
  ["a bound function", () => function (a, b) { this.value = [a, b]; return a + b; }.bind({}, 1)],
  ["a callable proxy", () => new Proxy(function () {}, { apply: (target, self, list) => (log.push("apply"), list[0]), construct: (target, list) => (log.push("construct"), { value: list[0] }) })],
  ["an async function", () => async v => v],
  ["an object with call and apply", () => ({ call: () => "call", apply: () => "apply" })],
  ["a string", () => "f"],
  ["undefined", () => undefined],
];

const notPoints = [
  ["the other key order", () => ({ y: 2, x: 1 })],
  ["a getter", () => ({ get x() { log.push("get x"); return 1; }, y: 2 })],
  ["accessors on the prototype", () => Object.create({ get x() { log.push("get x"); return 1; }, set x(v) { log.push("set x " + v); }, y: 2 })],
  ["a proxy", () => new Proxy({ x: 1, y: 2 }, { get: (target, key) => (log.push("get " + String(key)), target[key]), set: (target, key, v) => (log.push("set " + String(key)), (target[key] = v), true) })],
  ["y is missing", () => ({ x: 1 })],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["strings inside", () => ({ x: "1", y: "2" })],
  ["parsed JSON", () => JSON.parse('{"y":2,"x":1}')],
  ["a number", () => 5],
  ["null", () => null],
];

function honestFirst(round) {
  console.log(round, "total", total([1, 2, 3]), total([]), total([0.5, 0.25]), total(new Array(4, 5, 6)), total(Array.of(7, 8)), total([1, 2, 3, 4].slice(1)));
  console.log(round, "firstCode", firstCode("a"), firstCode("bc"), firstCode(""), firstCode("\\u00e9"), firstCode(\`t\${round}\`), firstCode(String(12)));
  console.log(round, "half", half(4), half(3), half(0.5), half(-8), half(1e21), half(0));
  console.log(round, "low", low(1), low(256), low(-1), low(1023), low(0), low(65535));
  console.log(round, "invoke", invoke(v => v + 1), invoke(function (v) { return v * 2; }), invoke(v => -v), invoke(v => [v].length), invoke(function same(v) { return v; }), invoke(() => 0));
  console.log(round, "sumOf", sumOf({ x: 1, y: 2 }), sumOf({ x: 3, y: 4 }), sumOf(new Point(5, 6)), sumOf({ x: 0.5, y: 0.5 }), sumOf(new Point(-1, 1)), sumOf({ x: 7, y: 8 }));
}

function honestSecond(round) {
  console.log(round, "append", append([1, 2, 3]), append([]), append(new Array(1, 2)), append(["a"]), append([[1], [2]]), append(Array.of(1, 2, 3, 4)));
  console.log(round, "tail", tail("abc"), tail(""), tail("x"), tail(\`t\${round}\`), tail("\\u00e9!"), tail(String(123)));
  console.log(round, "below", below(0), below(1), below(2.5), below(3), below(-1), below(10));
  console.log(round, "pick", pick(0), pick(1), pick(2), pick(3), pick(1 + 1), pick(letters.length - 1));
  console.log(round, "build", build(class { constructor(v) { this.value = v; } }), build(function (v) { this.value = v * 2; }), build(class { value = 3; }), build(function () {}), build(class extends Point { get value() { return this.x; } }), build(function (v) { return { value: -v }; }));
  console.log(round, "move", move({ x: 1, y: 2 }), move({ x: 3, y: 4 }), move(new Point(5, 6)), move({ x: 0.5, y: 0.5 }), move(new Point(-1, 1)), move({ x: 7, y: 8 }));
}

console.log("strict:", (function () { return this === undefined; })());
honestSecond("before");
for (const [name, make] of notArrays) {
  attempt("total of " + name, () => ${a});
  attempt("append to " + name, () => ${b});
}
attempt("total of a literal", () => ${c});
attempt("append to a literal", () => ${d});
for (const [name, make] of notStrings) {
  attempt("firstCode of " + name, () => ${e});
  attempt("tail of " + name, () => ${f});
}
attempt("firstCode of a literal", () => ${g});
attempt("tail of a literal", () => ${h});
for (const [name, make] of notNumbers) {
  attempt("half of " + name, () => ${i});
  attempt("below from " + name, () => ${j});
}
attempt("half of a literal", () => ${k});
attempt("below from a literal", () => ${l});
for (const [name, make] of notSmallIntegers) {
  attempt("low of " + name, () => ${m});
  attempt("pick at " + name, () => ${o});
}
attempt("low of a literal", () => ${p});
attempt("pick at a literal", () => ${q});
for (const [name, make] of notFunctions) {
  attempt("invoke of " + name, () => ${r});
  attempt("build from " + name, () => ${s});
}
attempt("invoke of a literal", () => ${t});
attempt("build from a literal", () => ${u});
for (const [name, make] of notPoints) {
  attempt("sumOf " + name, () => ${v});
  attempt("move " + name, () => ${w});
}
attempt("sumOf a literal", () => ${x});
attempt("move a literal", () => ${y});
honestFirst("after");
honestSecond("after");
`,
    ),
    ...family(
      `many-callers-and-an-impostor-through-a-bound-argument.cjs	half.bind(undefined, make())()	below.bind(undefined, make())()	half.bind(undefined, "4")()	below.bind(undefined, "1")()	low.bind(undefined, make())()	pick.bind(undefined, make())()	low.bind(undefined, 4294967297.5)()	pick.bind(undefined, "length")()	invoke.bind(undefined, make())()	build.bind(undefined, make())()	invoke.bind(undefined, class {})()	build.bind(undefined, () => {})()	sumOf.bind(undefined, make())()	move.bind(undefined, make())()	sumOf.bind(undefined, { y: 2, x: 1 })()	move.bind(undefined, { get x() { return 1; }, y: 2 })()	total.bind(undefined, make())()	append.bind(undefined, make())()	total.bind(undefined, "12")()	append.bind(undefined, { push: () => "a literal's push" })()	firstCode.bind(undefined, make())()	tail.bind(undefined, make())()	firstCode.bind(undefined, [65])()	tail.bind(undefined, [1, 2, 3])()
many-callers-and-an-impostor-through-a-closure-that-captured-it.cjs	(f => value => f(value))(half)(make())	(f => value => f(value))(below)(make())	(f => value => f(value))(half)("4")	(f => value => f(value))(below)("1")	(f => value => f(value))(low)(make())	(f => value => f(value))(pick)(make())	(f => value => f(value))(low)(4294967297.5)	(f => value => f(value))(pick)("length")	(f => value => f(value))(invoke)(make())	(f => value => f(value))(build)(make())	(f => value => f(value))(invoke)(class {})	(f => value => f(value))(build)(() => {})	(f => value => f(value))(sumOf)(make())	(f => value => f(value))(move)(make())	(f => value => f(value))(sumOf)({ y: 2, x: 1 })	(f => value => f(value))(move)({ get x() { return 1; }, y: 2 })	(f => value => f(value))(total)(make())	(f => value => f(value))(append)(make())	(f => value => f(value))(total)("12")	(f => value => f(value))(append)({ push: () => "a literal's push" })	(f => value => f(value))(firstCode)(make())	(f => value => f(value))(tail)(make())	(f => value => f(value))(firstCode)([65])	(f => value => f(value))(tail)([1, 2, 3])
many-callers-and-an-impostor-through-a-generator-that-yields-it.cjs	(function* () { yield half; })().next().value(make())	(function* () { yield below; })().next().value(make())	(function* () { yield half; })().next().value("4")	(function* () { yield below; })().next().value("1")	(function* () { yield low; })().next().value(make())	(function* () { yield pick; })().next().value(make())	(function* () { yield low; })().next().value(4294967297.5)	(function* () { yield pick; })().next().value("length")	(function* () { yield invoke; })().next().value(make())	(function* () { yield build; })().next().value(make())	(function* () { yield invoke; })().next().value(class {})	(function* () { yield build; })().next().value(() => {})	(function* () { yield sumOf; })().next().value(make())	(function* () { yield move; })().next().value(make())	(function* () { yield sumOf; })().next().value({ y: 2, x: 1 })	(function* () { yield move; })().next().value({ get x() { return 1; }, y: 2 })	(function* () { yield total; })().next().value(make())	(function* () { yield append; })().next().value(make())	(function* () { yield total; })().next().value("12")	(function* () { yield append; })().next().value({ push: () => "a literal's push" })	(function* () { yield firstCode; })().next().value(make())	(function* () { yield tail; })().next().value(make())	(function* () { yield firstCode; })().next().value([65])	(function* () { yield tail; })().next().value([1, 2, 3])
many-callers-and-an-impostor-through-a-proxy-of-it.cjs	new Proxy(half, {})(make())	new Proxy(below, {})(make())	new Proxy(half, {})("4")	new Proxy(below, {})("1")	new Proxy(low, {})(make())	new Proxy(pick, {})(make())	new Proxy(low, {})(4294967297.5)	new Proxy(pick, {})("length")	new Proxy(invoke, {})(make())	new Proxy(build, {})(make())	new Proxy(invoke, {})(class {})	new Proxy(build, {})(() => {})	new Proxy(sumOf, {})(make())	new Proxy(move, {})(make())	new Proxy(sumOf, {})({ y: 2, x: 1 })	new Proxy(move, {})({ get x() { return 1; }, y: 2 })	new Proxy(total, {})(make())	new Proxy(append, {})(make())	new Proxy(total, {})("12")	new Proxy(append, {})({ push: () => "a literal's push" })	new Proxy(firstCode, {})(make())	new Proxy(tail, {})(make())	new Proxy(firstCode, {})([65])	new Proxy(tail, {})([1, 2, 3])
many-callers-and-an-impostor-through-a-proxy-trap.cjs	new Proxy(Object(make()), { get: half }).anything	new Proxy(Object(make()), { get: below }).anything	new Proxy(Object("4"), { get: half }).anything	new Proxy(Object("1"), { get: below }).anything	new Proxy(Object(make()), { get: low }).anything	new Proxy(Object(make()), { get: pick }).anything	new Proxy(Object(4294967297.5), { get: low }).anything	new Proxy(Object("length"), { get: pick }).anything	new Proxy(Object(make()), { get: invoke }).anything	new Proxy(Object(make()), { get: build }).anything	new Proxy(Object(class {}), { get: invoke }).anything	new Proxy(Object(() => {}), { get: build }).anything	new Proxy(Object(make()), { get: sumOf }).anything	new Proxy(Object(make()), { get: move }).anything	new Proxy(Object({ y: 2, x: 1 }), { get: sumOf }).anything	new Proxy(Object({ get x() { return 1; }, y: 2 }), { get: move }).anything	new Proxy(Object(make()), { get: total }).anything	new Proxy(Object(make()), { get: append }).anything	new Proxy(Object("12"), { get: total }).anything	new Proxy(Object({ push: () => "a literal's push" }), { get: append }).anything	new Proxy(Object(make()), { get: firstCode }).anything	new Proxy(Object(make()), { get: tail }).anything	new Proxy(Object([65]), { get: firstCode }).anything	new Proxy(Object([1, 2, 3]), { get: tail }).anything
many-callers-and-an-impostor-through-a-setter.cjs	(Object.defineProperty({}, "value", { set: half }).value = make()) === 0	(Object.defineProperty({}, "value", { set: below }).value = make()) === 0	(Object.defineProperty({}, "value", { set: half }).value = "4") === 0	(Object.defineProperty({}, "value", { set: below }).value = "1") === 0	(Object.defineProperty({}, "value", { set: low }).value = make()) === 0	(Object.defineProperty({}, "value", { set: pick }).value = make()) === 0	(Object.defineProperty({}, "value", { set: low }).value = 4294967297.5) === 0	(Object.defineProperty({}, "value", { set: pick }).value = "length") === 0	(Object.defineProperty({}, "value", { set: invoke }).value = make()) === 0	(Object.defineProperty({}, "value", { set: build }).value = make()) === 0	(Object.defineProperty({}, "value", { set: invoke }).value = class {}) === 0	(Object.defineProperty({}, "value", { set: build }).value = () => {}) === 0	(Object.defineProperty({}, "value", { set: sumOf }).value = make()) === 0	(Object.defineProperty({}, "value", { set: move }).value = make()) === 0	(Object.defineProperty({}, "value", { set: sumOf }).value = { y: 2, x: 1 }) === 0	(Object.defineProperty({}, "value", { set: move }).value = { get x() { return 1; }, y: 2 }) === 0	(Object.defineProperty({}, "value", { set: total }).value = make()) === 0	(Object.defineProperty({}, "value", { set: append }).value = make()) === 0	(Object.defineProperty({}, "value", { set: total }).value = "12") === 0	(Object.defineProperty({}, "value", { set: append }).value = { push: () => "a literal's push" }) === 0	(Object.defineProperty({}, "value", { set: firstCode }).value = make()) === 0	(Object.defineProperty({}, "value", { set: tail }).value = make()) === 0	(Object.defineProperty({}, "value", { set: firstCode }).value = [65]) === 0	(Object.defineProperty({}, "value", { set: tail }).value = [1, 2, 3]) === 0
many-callers-and-an-impostor-through-an-array-pattern.cjs	{ const [f] = [half]; return f(make()); }	{ const [f] = [below]; return f(make()); }	{ const [f] = [half]; return f("4"); }	{ const [f] = [below]; return f("1"); }	{ const [f] = [low]; return f(make()); }	{ const [f] = [pick]; return f(make()); }	{ const [f] = [low]; return f(4294967297.5); }	{ const [f] = [pick]; return f("length"); }	{ const [f] = [invoke]; return f(make()); }	{ const [f] = [build]; return f(make()); }	{ const [f] = [invoke]; return f(class {}); }	{ const [f] = [build]; return f(() => {}); }	{ const [f] = [sumOf]; return f(make()); }	{ const [f] = [move]; return f(make()); }	{ const [f] = [sumOf]; return f({ y: 2, x: 1 }); }	{ const [f] = [move]; return f({ get x() { return 1; }, y: 2 }); }	{ const [f] = [total]; return f(make()); }	{ const [f] = [append]; return f(make()); }	{ const [f] = [total]; return f("12"); }	{ const [f] = [append]; return f({ push: () => "a literal's push" }); }	{ const [f] = [firstCode]; return f(make()); }	{ const [f] = [tail]; return f(make()); }	{ const [f] = [firstCode]; return f([65]); }	{ const [f] = [tail]; return f([1, 2, 3]); }
many-callers-and-an-impostor-through-an-optional-call.cjs	half?.(make())	below?.(make())	half?.("4")	below?.("1")	low?.(make())	pick?.(make())	low?.(4294967297.5)	pick?.("length")	invoke?.(make())	build?.(make())	invoke?.(class {})	build?.(() => {})	sumOf?.(make())	move?.(make())	sumOf?.({ y: 2, x: 1 })	move?.({ get x() { return 1; }, y: 2 })	total?.(make())	append?.(make())	total?.("12")	append?.({ push: () => "a literal's push" })	firstCode?.(make())	tail?.(make())	firstCode?.([65])	tail?.([1, 2, 3])
many-callers-and-an-impostor-through-reduce.cjs	[make(), 0].reduce(half)	[make(), 0].reduce(below)	["4", 0].reduce(half)	["1", 0].reduce(below)	[make(), 0].reduce(low)	[make(), 0].reduce(pick)	[4294967297.5, 0].reduce(low)	["length", 0].reduce(pick)	[make(), 0].reduce(invoke)	[make(), 0].reduce(build)	[class {}, 0].reduce(invoke)	[() => {}, 0].reduce(build)	[make(), 0].reduce(sumOf)	[make(), 0].reduce(move)	[{ y: 2, x: 1 }, 0].reduce(sumOf)	[{ get x() { return 1; }, y: 2 }, 0].reduce(move)	[make(), 0].reduce(total)	[make(), 0].reduce(append)	["12", 0].reduce(total)	[{ push: () => "a literal's push" }, 0].reduce(append)	[make(), 0].reduce(firstCode)	[make(), 0].reduce(tail)	[[65], 0].reduce(firstCode)	[[1, 2, 3], 0].reduce(tail)`,
      (a, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r, s, t, u, v, w, x, y) => `function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

let last;
const log = [];

function attempt(label, run) {
  last = "never set";
  log.length = 0;
  let line;
  try {
    line = "returned " + show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + ", last " + show(last) + (log.length ? ", log " + log.join(" ") : ""));
}

class Stack extends Array {
  push() {
    return "the subclass's push";
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function half(n) {
  return (last = n / 2);
}

function below(n) {
  let steps = 0;
  while (n < 3) {
    n++;
    steps++;
  }
  return (last = steps);
}

const letters = ["a", "b", "c", "d"];

function low(n) {
  return (last = n & 255);
}

function pick(i) {
  return (last = letters[i]);
}

function invoke(f) {
  return (last = f(2));
}

function build(f) {
  return (last = new f(2).value);
}

function sumOf(point) {
  return (last = point.x + point.y);
}

function move(point) {
  point.x = point.x + 1;
  return (last = point.x);
}

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function append(list) {
  return (last = list.push(4));
}

function firstCode(text) {
  return (last = text.charCodeAt(0));
}

function tail(text) {
  return (last = text.slice(1));
}

const notNumbers = [
  ["a numeric string", () => "1"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 1) })],
  ["an object with Symbol.toPrimitive", () => ({ [Symbol.toPrimitive]: hint => (log.push(hint), 2) })],
  ["a BigInt", () => 1n],
  ["an array of one", () => [1]],
  ["a symbol", () => Symbol("s")],
  ["negative zero", () => -0],
  ["null", () => null],
  ["undefined", () => undefined],
];

const notSmallIntegers = [
  ["two to the 31st", () => 2147483648],
  ["past two to the 32nd", () => 4294967297],
  ["a fraction", () => 1.5],
  ["negative zero", () => -0],
  ["NaN", () => NaN],
  ["a numeric string", () => "1"],
  ["a name", () => "length"],
  ["an object", () => ({ valueOf: () => (log.push("valueOf"), 2), toString: () => (log.push("toString"), "3") })],
  ["a BigInt", () => 1n],
  ["undefined", () => undefined],
];

const notFunctions = [
  ["a class", () => class { constructor(v) { this.value = v; } }],
  ["an arrow function", () => v => ({ value: v })],
  ["a bound function", () => function (a, b) { this.value = [a, b]; return a + b; }.bind({}, 1)],
  ["a callable proxy", () => new Proxy(function () {}, { apply: (target, self, list) => (log.push("apply"), list[0]), construct: (target, list) => (log.push("construct"), { value: list[0] }) })],
  ["an async function", () => async v => v],
  ["an object with call and apply", () => ({ call: () => "call", apply: () => "apply" })],
  ["a string", () => "f"],
  ["undefined", () => undefined],
];

const notPoints = [
  ["the other key order", () => ({ y: 2, x: 1 })],
  ["a getter", () => ({ get x() { log.push("get x"); return 1; }, y: 2 })],
  ["accessors on the prototype", () => Object.create({ get x() { log.push("get x"); return 1; }, set x(v) { log.push("set x " + v); }, y: 2 })],
  ["a proxy", () => new Proxy({ x: 1, y: 2 }, { get: (target, key) => (log.push("get " + String(key)), target[key]), set: (target, key, v) => (log.push("set " + String(key)), (target[key] = v), true) })],
  ["y is missing", () => ({ x: 1 })],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["strings inside", () => ({ x: "1", y: "2" })],
  ["parsed JSON", () => JSON.parse('{"y":2,"x":1}')],
  ["a number", () => 5],
  ["null", () => null],
];

const notArrays = [
  ["a string", () => "12"],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a subclass", () => new Stack(1, 2)],
  ["a frozen array", () => Object.freeze([1, 2])],
  ["an array of holes", () => new Array(2)],
  ["parsed JSON", () => JSON.parse('{"0":5,"length":1}')],
  ["null", () => null],
];

const notStrings = [
  ["an array", () => ["a", "b"]],
  ["a String object", () => new String("ab")],
  ["an object with the methods", () => ({ charCodeAt: () => "a code", slice: () => "a slice" })],
  ["a Buffer", () => Buffer.from("ab")],
  ["a number", () => 65],
  ["undefined", () => undefined],
];

function honestFirst(round) {
  console.log(round, "half", half(4), half(3), half(0.5), half(-8), half(1e21), half(0));
  console.log(round, "low", low(1), low(256), low(-1), low(1023), low(0), low(65535));
  console.log(round, "invoke", invoke(v => v + 1), invoke(function (v) { return v * 2; }), invoke(v => -v), invoke(v => [v].length), invoke(function same(v) { return v; }), invoke(() => 0));
  console.log(round, "sumOf", sumOf({ x: 1, y: 2 }), sumOf({ x: 3, y: 4 }), sumOf(new Point(5, 6)), sumOf({ x: 0.5, y: 0.5 }), sumOf(new Point(-1, 1)), sumOf({ x: 7, y: 8 }));
  console.log(round, "total", total([1, 2, 3]), total([]), total([0.5, 0.25]), total(new Array(4, 5, 6)), total(Array.of(7, 8)), total([1, 2, 3, 4].slice(1)));
  console.log(round, "firstCode", firstCode("a"), firstCode("bc"), firstCode(""), firstCode("\\u00e9"), firstCode(\`t\${round}\`), firstCode(String(12)));
}

function honestSecond(round) {
  console.log(round, "below", below(0), below(1), below(2.5), below(3), below(-1), below(10));
  console.log(round, "pick", pick(0), pick(1), pick(2), pick(3), pick(1 + 1), pick(letters.length - 1));
  console.log(round, "build", build(class { constructor(v) { this.value = v; } }), build(function (v) { this.value = v * 2; }), build(class { value = 3; }), build(function () {}), build(class extends Point { get value() { return this.x; } }), build(function (v) { return { value: -v }; }));
  console.log(round, "move", move({ x: 1, y: 2 }), move({ x: 3, y: 4 }), move(new Point(5, 6)), move({ x: 0.5, y: 0.5 }), move(new Point(-1, 1)), move({ x: 7, y: 8 }));
  console.log(round, "append", append([1, 2, 3]), append([]), append(new Array(1, 2)), append(["a"]), append([[1], [2]]), append(Array.of(1, 2, 3, 4)));
  console.log(round, "tail", tail("abc"), tail(""), tail("x"), tail(\`t\${round}\`), tail("\\u00e9!"), tail(String(123)));
}

console.log("strict:", (function () { return this === undefined; })());
honestSecond("before");
for (const [name, make] of notNumbers) {
  attempt("half of " + name, () => ${a});
  attempt("below from " + name, () => ${b});
}
attempt("half of a literal", () => ${c});
attempt("below from a literal", () => ${d});
for (const [name, make] of notSmallIntegers) {
  attempt("low of " + name, () => ${e});
  attempt("pick at " + name, () => ${f});
}
attempt("low of a literal", () => ${g});
attempt("pick at a literal", () => ${h});
for (const [name, make] of notFunctions) {
  attempt("invoke of " + name, () => ${i});
  attempt("build from " + name, () => ${j});
}
attempt("invoke of a literal", () => ${k});
attempt("build from a literal", () => ${l});
for (const [name, make] of notPoints) {
  attempt("sumOf " + name, () => ${m});
  attempt("move " + name, () => ${o});
}
attempt("sumOf a literal", () => ${p});
attempt("move a literal", () => ${q});
for (const [name, make] of notArrays) {
  attempt("total of " + name, () => ${r});
  attempt("append to " + name, () => ${s});
}
attempt("total of a literal", () => ${t});
attempt("append to a literal", () => ${u});
for (const [name, make] of notStrings) {
  attempt("firstCode of " + name, () => ${v});
  attempt("tail of " + name, () => ${w});
}
attempt("firstCode of a literal", () => ${x});
attempt("tail of a literal", () => ${y});
honestFirst("after");
honestSecond("after");
`,
    ),
    ...family(
      `many-callers-and-an-impostor-through-a-global-variable.cjs	{ globalThis.sharedFunction = invoke; return sharedFunction(make()); }	{ globalThis.sharedFunction = build; return sharedFunction(make()); }	{ globalThis.sharedFunction = invoke; return sharedFunction(class {}); }	{ globalThis.sharedFunction = build; return sharedFunction(() => {}); }	{ globalThis.sharedFunction = sumOf; return sharedFunction(make()); }	{ globalThis.sharedFunction = move; return sharedFunction(make()); }	{ globalThis.sharedFunction = sumOf; return sharedFunction({ y: 2, x: 1 }); }	{ globalThis.sharedFunction = move; return sharedFunction({ get x() { return 1; }, y: 2 }); }	{ globalThis.sharedFunction = total; return sharedFunction(make()); }	{ globalThis.sharedFunction = append; return sharedFunction(make()); }	{ globalThis.sharedFunction = total; return sharedFunction("12"); }	{ globalThis.sharedFunction = append; return sharedFunction({ push: () => "a literal's push" }); }	{ globalThis.sharedFunction = firstCode; return sharedFunction(make()); }	{ globalThis.sharedFunction = tail; return sharedFunction(make()); }	{ globalThis.sharedFunction = firstCode; return sharedFunction([65]); }	{ globalThis.sharedFunction = tail; return sharedFunction([1, 2, 3]); }	{ globalThis.sharedFunction = half; return sharedFunction(make()); }	{ globalThis.sharedFunction = below; return sharedFunction(make()); }	{ globalThis.sharedFunction = half; return sharedFunction("4"); }	{ globalThis.sharedFunction = below; return sharedFunction("1"); }	{ globalThis.sharedFunction = low; return sharedFunction(make()); }	{ globalThis.sharedFunction = pick; return sharedFunction(make()); }	{ globalThis.sharedFunction = low; return sharedFunction(4294967297.5); }	{ globalThis.sharedFunction = pick; return sharedFunction("length"); }
many-callers-and-an-impostor-through-a-map-entry.cjs	new Map([["run", invoke]]).get("run")(make())	new Map([["run", build]]).get("run")(make())	new Map([["run", invoke]]).get("run")(class {})	new Map([["run", build]]).get("run")(() => {})	new Map([["run", sumOf]]).get("run")(make())	new Map([["run", move]]).get("run")(make())	new Map([["run", sumOf]]).get("run")({ y: 2, x: 1 })	new Map([["run", move]]).get("run")({ get x() { return 1; }, y: 2 })	new Map([["run", total]]).get("run")(make())	new Map([["run", append]]).get("run")(make())	new Map([["run", total]]).get("run")("12")	new Map([["run", append]]).get("run")({ push: () => "a literal's push" })	new Map([["run", firstCode]]).get("run")(make())	new Map([["run", tail]]).get("run")(make())	new Map([["run", firstCode]]).get("run")([65])	new Map([["run", tail]]).get("run")([1, 2, 3])	new Map([["run", half]]).get("run")(make())	new Map([["run", below]]).get("run")(make())	new Map([["run", half]]).get("run")("4")	new Map([["run", below]]).get("run")("1")	new Map([["run", low]]).get("run")(make())	new Map([["run", pick]]).get("run")(make())	new Map([["run", low]]).get("run")(4294967297.5)	new Map([["run", pick]]).get("run")("length")
many-callers-and-an-impostor-through-a-with-statement.cjs	{ with ({ run: invoke }) return run(make()); }	{ with ({ run: build }) return run(make()); }	{ with ({ run: invoke }) return run(class {}); }	{ with ({ run: build }) return run(() => {}); }	{ with ({ run: sumOf }) return run(make()); }	{ with ({ run: move }) return run(make()); }	{ with ({ run: sumOf }) return run({ y: 2, x: 1 }); }	{ with ({ run: move }) return run({ get x() { return 1; }, y: 2 }); }	{ with ({ run: total }) return run(make()); }	{ with ({ run: append }) return run(make()); }	{ with ({ run: total }) return run("12"); }	{ with ({ run: append }) return run({ push: () => "a literal's push" }); }	{ with ({ run: firstCode }) return run(make()); }	{ with ({ run: tail }) return run(make()); }	{ with ({ run: firstCode }) return run([65]); }	{ with ({ run: tail }) return run([1, 2, 3]); }	{ with ({ run: half }) return run(make()); }	{ with ({ run: below }) return run(make()); }	{ with ({ run: half }) return run("4"); }	{ with ({ run: below }) return run("1"); }	{ with ({ run: low }) return run(make()); }	{ with ({ run: pick }) return run(make()); }	{ with ({ run: low }) return run(4294967297.5); }	{ with ({ run: pick }) return run("length"); }
many-callers-and-an-impostor-through-apply-bound-to-it.cjs	Function.prototype.apply.bind(invoke)(undefined, [make()])	Function.prototype.apply.bind(build)(undefined, [make()])	Function.prototype.apply.bind(invoke)(undefined, [class {}])	Function.prototype.apply.bind(build)(undefined, [() => {}])	Function.prototype.apply.bind(sumOf)(undefined, [make()])	Function.prototype.apply.bind(move)(undefined, [make()])	Function.prototype.apply.bind(sumOf)(undefined, [{ y: 2, x: 1 }])	Function.prototype.apply.bind(move)(undefined, [{ get x() { return 1; }, y: 2 }])	Function.prototype.apply.bind(total)(undefined, [make()])	Function.prototype.apply.bind(append)(undefined, [make()])	Function.prototype.apply.bind(total)(undefined, ["12"])	Function.prototype.apply.bind(append)(undefined, [{ push: () => "a literal's push" }])	Function.prototype.apply.bind(firstCode)(undefined, [make()])	Function.prototype.apply.bind(tail)(undefined, [make()])	Function.prototype.apply.bind(firstCode)(undefined, [[65]])	Function.prototype.apply.bind(tail)(undefined, [[1, 2, 3]])	Function.prototype.apply.bind(half)(undefined, [make()])	Function.prototype.apply.bind(below)(undefined, [make()])	Function.prototype.apply.bind(half)(undefined, ["4"])	Function.prototype.apply.bind(below)(undefined, ["1"])	Function.prototype.apply.bind(low)(undefined, [make()])	Function.prototype.apply.bind(pick)(undefined, [make()])	Function.prototype.apply.bind(low)(undefined, [4294967297.5])	Function.prototype.apply.bind(pick)(undefined, ["length"])
many-callers-and-an-impostor-through-array-from.cjs	Array.from([make()], invoke)[0]	Array.from([make()], build)[0]	Array.from([class {}], invoke)[0]	Array.from([() => {}], build)[0]	Array.from([make()], sumOf)[0]	Array.from([make()], move)[0]	Array.from([{ y: 2, x: 1 }], sumOf)[0]	Array.from([{ get x() { return 1; }, y: 2 }], move)[0]	Array.from([make()], total)[0]	Array.from([make()], append)[0]	Array.from(["12"], total)[0]	Array.from([{ push: () => "a literal's push" }], append)[0]	Array.from([make()], firstCode)[0]	Array.from([make()], tail)[0]	Array.from([[65]], firstCode)[0]	Array.from([[1, 2, 3]], tail)[0]	Array.from([make()], half)[0]	Array.from([make()], below)[0]	Array.from(["4"], half)[0]	Array.from(["1"], below)[0]	Array.from([make()], low)[0]	Array.from([make()], pick)[0]	Array.from([4294967297.5], low)[0]	Array.from(["length"], pick)[0]
many-callers-and-an-impostor-through-call-called-with-call.cjs	Function.prototype.call.call(invoke, undefined, make())	Function.prototype.call.call(build, undefined, make())	Function.prototype.call.call(invoke, undefined, class {})	Function.prototype.call.call(build, undefined, () => {})	Function.prototype.call.call(sumOf, undefined, make())	Function.prototype.call.call(move, undefined, make())	Function.prototype.call.call(sumOf, undefined, { y: 2, x: 1 })	Function.prototype.call.call(move, undefined, { get x() { return 1; }, y: 2 })	Function.prototype.call.call(total, undefined, make())	Function.prototype.call.call(append, undefined, make())	Function.prototype.call.call(total, undefined, "12")	Function.prototype.call.call(append, undefined, { push: () => "a literal's push" })	Function.prototype.call.call(firstCode, undefined, make())	Function.prototype.call.call(tail, undefined, make())	Function.prototype.call.call(firstCode, undefined, [65])	Function.prototype.call.call(tail, undefined, [1, 2, 3])	Function.prototype.call.call(half, undefined, make())	Function.prototype.call.call(below, undefined, make())	Function.prototype.call.call(half, undefined, "4")	Function.prototype.call.call(below, undefined, "1")	Function.prototype.call.call(low, undefined, make())	Function.prototype.call.call(pick, undefined, make())	Function.prototype.call.call(low, undefined, 4294967297.5)	Function.prototype.call.call(pick, undefined, "length")
many-callers-and-an-impostor-through-call.cjs	invoke.call(undefined, make())	build.call(undefined, make())	invoke.call(undefined, class {})	build.call(undefined, () => {})	sumOf.call(undefined, make())	move.call(undefined, make())	sumOf.call(undefined, { y: 2, x: 1 })	move.call(undefined, { get x() { return 1; }, y: 2 })	total.call(undefined, make())	append.call(undefined, make())	total.call(undefined, "12")	append.call(undefined, { push: () => "a literal's push" })	firstCode.call(undefined, make())	tail.call(undefined, make())	firstCode.call(undefined, [65])	tail.call(undefined, [1, 2, 3])	half.call(undefined, make())	below.call(undefined, make())	half.call(undefined, "4")	below.call(undefined, "1")	low.call(undefined, make())	pick.call(undefined, make())	low.call(undefined, 4294967297.5)	pick.call(undefined, "length")
many-callers-and-an-impostor-through-eval.cjs	{ const value = make(); return eval("invoke(value)"); }	{ const value = make(); return eval("build(value)"); }	{ const value = class {}; return eval("invoke(value)"); }	{ const value = () => {}; return eval("build(value)"); }	{ const value = make(); return eval("sumOf(value)"); }	{ const value = make(); return eval("move(value)"); }	{ const value = { y: 2, x: 1 }; return eval("sumOf(value)"); }	{ const value = { get x() { return 1; }, y: 2 }; return eval("move(value)"); }	{ const value = make(); return eval("total(value)"); }	{ const value = make(); return eval("append(value)"); }	{ const value = "12"; return eval("total(value)"); }	{ const value = { push: () => "a literal's push" }; return eval("append(value)"); }	{ const value = make(); return eval("firstCode(value)"); }	{ const value = make(); return eval("tail(value)"); }	{ const value = [65]; return eval("firstCode(value)"); }	{ const value = [1, 2, 3]; return eval("tail(value)"); }	{ const value = make(); return eval("half(value)"); }	{ const value = make(); return eval("below(value)"); }	{ const value = "4"; return eval("half(value)"); }	{ const value = "1"; return eval("below(value)"); }	{ const value = make(); return eval("low(value)"); }	{ const value = make(); return eval("pick(value)"); }	{ const value = 4294967297.5; return eval("low(value)"); }	{ const value = "length"; return eval("pick(value)"); }
many-callers-and-an-impostor-through-object-values.cjs	Object.values({ run: invoke })[0](make())	Object.values({ run: build })[0](make())	Object.values({ run: invoke })[0](class {})	Object.values({ run: build })[0](() => {})	Object.values({ run: sumOf })[0](make())	Object.values({ run: move })[0](make())	Object.values({ run: sumOf })[0]({ y: 2, x: 1 })	Object.values({ run: move })[0]({ get x() { return 1; }, y: 2 })	Object.values({ run: total })[0](make())	Object.values({ run: append })[0](make())	Object.values({ run: total })[0]("12")	Object.values({ run: append })[0]({ push: () => "a literal's push" })	Object.values({ run: firstCode })[0](make())	Object.values({ run: tail })[0](make())	Object.values({ run: firstCode })[0]([65])	Object.values({ run: tail })[0]([1, 2, 3])	Object.values({ run: half })[0](make())	Object.values({ run: below })[0](make())	Object.values({ run: half })[0]("4")	Object.values({ run: below })[0]("1")	Object.values({ run: low })[0](make())	Object.values({ run: pick })[0](make())	Object.values({ run: low })[0](4294967297.5)	Object.values({ run: pick })[0]("length")`,
      (a, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r, s, t, u, v, w, x, y) => `function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

let last;
const log = [];

function attempt(label, run) {
  last = "never set";
  log.length = 0;
  let line;
  try {
    line = "returned " + show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + ", last " + show(last) + (log.length ? ", log " + log.join(" ") : ""));
}

class Stack extends Array {
  push() {
    return "the subclass's push";
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function invoke(f) {
  return (last = f(2));
}

function build(f) {
  return (last = new f(2).value);
}

function sumOf(point) {
  return (last = point.x + point.y);
}

function move(point) {
  point.x = point.x + 1;
  return (last = point.x);
}

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function append(list) {
  return (last = list.push(4));
}

function firstCode(text) {
  return (last = text.charCodeAt(0));
}

function tail(text) {
  return (last = text.slice(1));
}

function half(n) {
  return (last = n / 2);
}

function below(n) {
  let steps = 0;
  while (n < 3) {
    n++;
    steps++;
  }
  return (last = steps);
}

const letters = ["a", "b", "c", "d"];

function low(n) {
  return (last = n & 255);
}

function pick(i) {
  return (last = letters[i]);
}

const notFunctions = [
  ["a class", () => class { constructor(v) { this.value = v; } }],
  ["an arrow function", () => v => ({ value: v })],
  ["a bound function", () => function (a, b) { this.value = [a, b]; return a + b; }.bind({}, 1)],
  ["a callable proxy", () => new Proxy(function () {}, { apply: (target, self, list) => (log.push("apply"), list[0]), construct: (target, list) => (log.push("construct"), { value: list[0] }) })],
  ["an async function", () => async v => v],
  ["an object with call and apply", () => ({ call: () => "call", apply: () => "apply" })],
  ["a string", () => "f"],
  ["undefined", () => undefined],
];

const notPoints = [
  ["the other key order", () => ({ y: 2, x: 1 })],
  ["a getter", () => ({ get x() { log.push("get x"); return 1; }, y: 2 })],
  ["accessors on the prototype", () => Object.create({ get x() { log.push("get x"); return 1; }, set x(v) { log.push("set x " + v); }, y: 2 })],
  ["a proxy", () => new Proxy({ x: 1, y: 2 }, { get: (target, key) => (log.push("get " + String(key)), target[key]), set: (target, key, v) => (log.push("set " + String(key)), (target[key] = v), true) })],
  ["y is missing", () => ({ x: 1 })],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["strings inside", () => ({ x: "1", y: "2" })],
  ["parsed JSON", () => JSON.parse('{"y":2,"x":1}')],
  ["a number", () => 5],
  ["null", () => null],
];

const notArrays = [
  ["a string", () => "12"],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a subclass", () => new Stack(1, 2)],
  ["a frozen array", () => Object.freeze([1, 2])],
  ["an array of holes", () => new Array(2)],
  ["parsed JSON", () => JSON.parse('{"0":5,"length":1}')],
  ["null", () => null],
];

const notStrings = [
  ["an array", () => ["a", "b"]],
  ["a String object", () => new String("ab")],
  ["an object with the methods", () => ({ charCodeAt: () => "a code", slice: () => "a slice" })],
  ["a Buffer", () => Buffer.from("ab")],
  ["a number", () => 65],
  ["undefined", () => undefined],
];

const notNumbers = [
  ["a numeric string", () => "1"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 1) })],
  ["an object with Symbol.toPrimitive", () => ({ [Symbol.toPrimitive]: hint => (log.push(hint), 2) })],
  ["a BigInt", () => 1n],
  ["an array of one", () => [1]],
  ["a symbol", () => Symbol("s")],
  ["negative zero", () => -0],
  ["null", () => null],
  ["undefined", () => undefined],
];

const notSmallIntegers = [
  ["two to the 31st", () => 2147483648],
  ["past two to the 32nd", () => 4294967297],
  ["a fraction", () => 1.5],
  ["negative zero", () => -0],
  ["NaN", () => NaN],
  ["a numeric string", () => "1"],
  ["a name", () => "length"],
  ["an object", () => ({ valueOf: () => (log.push("valueOf"), 2), toString: () => (log.push("toString"), "3") })],
  ["a BigInt", () => 1n],
  ["undefined", () => undefined],
];

function honestFirst(round) {
  console.log(round, "invoke", invoke(v => v + 1), invoke(function (v) { return v * 2; }), invoke(v => -v), invoke(v => [v].length), invoke(function same(v) { return v; }), invoke(() => 0));
  console.log(round, "sumOf", sumOf({ x: 1, y: 2 }), sumOf({ x: 3, y: 4 }), sumOf(new Point(5, 6)), sumOf({ x: 0.5, y: 0.5 }), sumOf(new Point(-1, 1)), sumOf({ x: 7, y: 8 }));
  console.log(round, "total", total([1, 2, 3]), total([]), total([0.5, 0.25]), total(new Array(4, 5, 6)), total(Array.of(7, 8)), total([1, 2, 3, 4].slice(1)));
  console.log(round, "firstCode", firstCode("a"), firstCode("bc"), firstCode(""), firstCode("\\u00e9"), firstCode(\`t\${round}\`), firstCode(String(12)));
  console.log(round, "half", half(4), half(3), half(0.5), half(-8), half(1e21), half(0));
  console.log(round, "low", low(1), low(256), low(-1), low(1023), low(0), low(65535));
}

function honestSecond(round) {
  console.log(round, "build", build(class { constructor(v) { this.value = v; } }), build(function (v) { this.value = v * 2; }), build(class { value = 3; }), build(function () {}), build(class extends Point { get value() { return this.x; } }), build(function (v) { return { value: -v }; }));
  console.log(round, "move", move({ x: 1, y: 2 }), move({ x: 3, y: 4 }), move(new Point(5, 6)), move({ x: 0.5, y: 0.5 }), move(new Point(-1, 1)), move({ x: 7, y: 8 }));
  console.log(round, "append", append([1, 2, 3]), append([]), append(new Array(1, 2)), append(["a"]), append([[1], [2]]), append(Array.of(1, 2, 3, 4)));
  console.log(round, "tail", tail("abc"), tail(""), tail("x"), tail(\`t\${round}\`), tail("\\u00e9!"), tail(String(123)));
  console.log(round, "below", below(0), below(1), below(2.5), below(3), below(-1), below(10));
  console.log(round, "pick", pick(0), pick(1), pick(2), pick(3), pick(1 + 1), pick(letters.length - 1));
}

console.log("strict:", (function () { return this === undefined; })());
honestSecond("before");
for (const [name, make] of notFunctions) {
  attempt("invoke of " + name, () => ${a});
  attempt("build from " + name, () => ${b});
}
attempt("invoke of a literal", () => ${c});
attempt("build from a literal", () => ${d});
for (const [name, make] of notPoints) {
  attempt("sumOf " + name, () => ${e});
  attempt("move " + name, () => ${f});
}
attempt("sumOf a literal", () => ${g});
attempt("move a literal", () => ${h});
for (const [name, make] of notArrays) {
  attempt("total of " + name, () => ${i});
  attempt("append to " + name, () => ${j});
}
attempt("total of a literal", () => ${k});
attempt("append to a literal", () => ${l});
for (const [name, make] of notStrings) {
  attempt("firstCode of " + name, () => ${m});
  attempt("tail of " + name, () => ${o});
}
attempt("firstCode of a literal", () => ${p});
attempt("tail of a literal", () => ${q});
for (const [name, make] of notNumbers) {
  attempt("half of " + name, () => ${r});
  attempt("below from " + name, () => ${s});
}
attempt("half of a literal", () => ${t});
attempt("below from a literal", () => ${u});
for (const [name, make] of notSmallIntegers) {
  attempt("low of " + name, () => ${v});
  attempt("pick at " + name, () => ${w});
}
attempt("low of a literal", () => ${x});
attempt("pick at a literal", () => ${y});
honestFirst("after");
honestSecond("after");
`,
    ),
    ...family(
      `reflect-apply-passes-the-value-in-an-array-like.js	Given(a	a	given => Reflect.apply(pushesGiven, undefined, { length: 1, 0: given }	given => Reflect.apply(iteratesGiven, undefined, { length: 1, 0: given }	Given(s		given => Reflect.apply(readsCharCodeGiven, undefined, { length: 1, 0: given }	Given(n	n	given => Reflect.apply(truncatesGiven, undefined, { length: 1, 0: given }	given => Reflect.apply(addsOneGiven, undefined, { length: 1, 0: given }	Given(f	f	given => Reflect.apply(callsGiven, undefined, { length: 1, 0: given }	Given(o	o.x + o	given => Reflect.apply(addsMembersGiven, undefined, { length: 1, 0: given }	o	given => Reflect.apply(storesMemberGiven, undefined, { length: 1, 0: given }
the-function-is-bound-once-and-called-with-the-value.js	Given(a	a	pushesGiven.bind(undefined	iteratesGiven.bind(undefined	Given(s		readsCharCodeGiven.bind(undefined	Given(n	n	truncatesGiven.bind(undefined	addsOneGiven.bind(undefined	Given(f	f	callsGiven.bind(undefined	Given(o	o.x + o	addsMembersGiven.bind(undefined	o	storesMemberGiven.bind(undefined
the-value-is-passed-through-apply.js	Given(a	a	value => pushesGiven.apply(undefined, [value]	value => iteratesGiven.apply(undefined, [value]	Given(s		value => readsCharCodeGiven.apply(undefined, [value]	Given(n	n	value => truncatesGiven.apply(undefined, [value]	value => addsOneGiven.apply(undefined, [value]	Given(f	f	value => callsGiven.apply(undefined, [value]	Given(o	o.x + o	value => addsMembersGiven.apply(undefined, [value]	o	value => storesMemberGiven.apply(undefined, [value]
this-is-the-value-in-strict-code.js	This(	this	given => pushesThis.call(given	given => iteratesThis.call(given	This(	thi	given => readsCharCodeThis.call(given	This(	this	given => truncatesThis.call(given	given => addsOneThis.call(given	This(	this	given => callsThis.call(given	This(	this.x + this	given => addsMembersThis.call(given	this	given => storesMemberThis.call(given`,
      (a, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r, s, t) => `"use strict";

const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

const arrays = [
  ["an array", () => [5, 6]],
  ["a subclass", () => Odd.of(5, 6)],
  ["an array-like", () => ({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })],
  ["a proxy", () => logged([5, 6])],
  ["a frozen array", () => Object.freeze([5, 6])],
  ["a string", () => "ab"],
];

const strings = [
  ["a string", () => "abc"],
  ["an object with charCodeAt", () => ({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })],
  ["a String object with its own charCodeAt", () => Object.assign(new String("xyz"), { charCodeAt: () => -1 })],
  ["an array", () => ["abc"]],
  ["a number", () => 65],
];

const numbers = [
  ["an integer", () => 7],
  ["a string", () => "3"],
  ["an object with valueOf", () => ({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })],
  ["a bigint", () => 10n],
  ["the largest int32", () => 2147483647],
  ["minus zero", () => -0],
  ["undefined", () => undefined],
];

const functions = [
  ["a function", () => x => x + 1],
  ["a class", () => class Made { constructor(x) { log.push("constructed " + x); } }],
  ["a callable proxy", () => logged(x => x + 2)],
  ["a bound function", () => function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first")],
  ["an object with call", () => ({ call() { log.push("call"); return "called"; } })],
];

const objects = [
  ["an object", () => ({ x: 1, y: 2 })],
  ["accessors", () => ({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })],
  ["a proxy", () => logged({ y: 2, x: 1 })],
  ["a frozen object", () => Object.freeze({ x: 5, y: 6 })],
  ["texts in another order", () => ({ y: "2", x: "1" })],
  ["inherited members", () => Object.create({ x: 3, y: 4 })],
];

function pushes${a}) {
  ${b}.push(1);
  return ${b}.length;
}
const pushes = ${c});

function iterates${a}) {
  const seen = [];
  for (const x of ${b}) seen.push(x);
  return seen;
}
const iterates = ${d});

function readsCharCode${e}) {
  return ${f}s.charCodeAt(0);
}
const readsCharCode = ${g});

function truncates${h}) {
  return ${i} | 0;
}
const truncates = ${j});

function addsOne${h}) {
  return ${i} + 1;
}
const addsOne = ${k});

function calls${l}) {
  return ${m}(1);
}
const calls = ${o});

function addsMembers${p}) {
  return ${q}.y;
}
const addsMembers = ${r});

function storesMember${p}) {
  ${s}.x = 1;
  return ${s};
}
const storesMember = ${t});

const table = [
  ["pushes", pushes, arrays],
  ["iterates", iterates, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["truncates", truncates, numbers],
  ["addsOne", addsOne, numbers],
  ["calls", calls, functions],
  ["addsMembers", addsMembers, objects],
  ["storesMember", storesMember, objects],
];

function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, make] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use(make()));
  }
}

console.log("strict:", (function () { return this === undefined; })());
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes([5, 6]);
  iterates([5, 6]);
  readsCharCode("abc");
  truncates(7);
  addsOne(7);
  calls(x => x + 1);
  addsMembers(({ x: 1, y: 2 }));
  storesMember(({ x: 1, y: 2 }));
}
everyCase("after 2000");
`,
    ),
    ...family(
      `many-callers-and-an-impostor-through-a-bound-copy-handed-to-map.js	[make()].map(low.bind(undefined))[0]	[make()].map(pick.bind(undefined))[0]	[4294967297.5].map(low.bind(undefined))[0]	["length"].map(pick.bind(undefined))[0]	[make()].map(invoke.bind(undefined))[0]	[make()].map(build.bind(undefined))[0]	[class {}].map(invoke.bind(undefined))[0]	[() => {}].map(build.bind(undefined))[0]	[make()].map(sumOf.bind(undefined))[0]	[make()].map(move.bind(undefined))[0]	[{ y: 2, x: 1 }].map(sumOf.bind(undefined))[0]	[{ get x() { return 1; }, y: 2 }].map(move.bind(undefined))[0]	[make()].map(total.bind(undefined))[0]	[make()].map(append.bind(undefined))[0]	["12"].map(total.bind(undefined))[0]	[{ push: () => "a literal's push" }].map(append.bind(undefined))[0]	[make()].map(firstCode.bind(undefined))[0]	[make()].map(tail.bind(undefined))[0]	[[65]].map(firstCode.bind(undefined))[0]	[[1, 2, 3]].map(tail.bind(undefined))[0]	[make()].map(half.bind(undefined))[0]	[make()].map(below.bind(undefined))[0]	["4"].map(half.bind(undefined))[0]	["1"].map(below.bind(undefined))[0]
many-callers-and-an-impostor-through-a-call-in-parentheses.js	(0, low)(make())	(0, pick)(make())	(0, low)(4294967297.5)	(0, pick)("length")	(0, invoke)(make())	(0, build)(make())	(0, invoke)(class {})	(0, build)(() => {})	(0, sumOf)(make())	(0, move)(make())	(0, sumOf)({ y: 2, x: 1 })	(0, move)({ get x() { return 1; }, y: 2 })	(0, total)(make())	(0, append)(make())	(0, total)("12")	(0, append)({ push: () => "a literal's push" })	(0, firstCode)(make())	(0, tail)(make())	(0, firstCode)([65])	(0, tail)([1, 2, 3])	(0, half)(make())	(0, below)(make())	(0, half)("4")	(0, below)("1")
many-callers-and-an-impostor-through-a-proxy-whose-trap-forwards.js	new Proxy(low, { apply: (target, self, list) => target(...list) })(make())	new Proxy(pick, { apply: (target, self, list) => target(...list) })(make())	new Proxy(low, { apply: (target, self, list) => target(...list) })(4294967297.5)	new Proxy(pick, { apply: (target, self, list) => target(...list) })("length")	new Proxy(invoke, { apply: (target, self, list) => target(...list) })(make())	new Proxy(build, { apply: (target, self, list) => target(...list) })(make())	new Proxy(invoke, { apply: (target, self, list) => target(...list) })(class {})	new Proxy(build, { apply: (target, self, list) => target(...list) })(() => {})	new Proxy(sumOf, { apply: (target, self, list) => target(...list) })(make())	new Proxy(move, { apply: (target, self, list) => target(...list) })(make())	new Proxy(sumOf, { apply: (target, self, list) => target(...list) })({ y: 2, x: 1 })	new Proxy(move, { apply: (target, self, list) => target(...list) })({ get x() { return 1; }, y: 2 })	new Proxy(total, { apply: (target, self, list) => target(...list) })(make())	new Proxy(append, { apply: (target, self, list) => target(...list) })(make())	new Proxy(total, { apply: (target, self, list) => target(...list) })("12")	new Proxy(append, { apply: (target, self, list) => target(...list) })({ push: () => "a literal's push" })	new Proxy(firstCode, { apply: (target, self, list) => target(...list) })(make())	new Proxy(tail, { apply: (target, self, list) => target(...list) })(make())	new Proxy(firstCode, { apply: (target, self, list) => target(...list) })([65])	new Proxy(tail, { apply: (target, self, list) => target(...list) })([1, 2, 3])	new Proxy(half, { apply: (target, self, list) => target(...list) })(make())	new Proxy(below, { apply: (target, self, list) => target(...list) })(make())	new Proxy(half, { apply: (target, self, list) => target(...list) })("4")	new Proxy(below, { apply: (target, self, list) => target(...list) })("1")
many-callers-and-an-impostor-through-a-value-of-a-template.js	((strings, f) => f(make()))\`\${low}\`	((strings, f) => f(make()))\`\${pick}\`	((strings, f) => f(4294967297.5))\`\${low}\`	((strings, f) => f("length"))\`\${pick}\`	((strings, f) => f(make()))\`\${invoke}\`	((strings, f) => f(make()))\`\${build}\`	((strings, f) => f(class {}))\`\${invoke}\`	((strings, f) => f(() => {}))\`\${build}\`	((strings, f) => f(make()))\`\${sumOf}\`	((strings, f) => f(make()))\`\${move}\`	((strings, f) => f({ y: 2, x: 1 }))\`\${sumOf}\`	((strings, f) => f({ get x() { return 1; }, y: 2 }))\`\${move}\`	((strings, f) => f(make()))\`\${total}\`	((strings, f) => f(make()))\`\${append}\`	((strings, f) => f("12"))\`\${total}\`	((strings, f) => f({ push: () => "a literal's push" }))\`\${append}\`	((strings, f) => f(make()))\`\${firstCode}\`	((strings, f) => f(make()))\`\${tail}\`	((strings, f) => f([65]))\`\${firstCode}\`	((strings, f) => f([1, 2, 3]))\`\${tail}\`	((strings, f) => f(make()))\`\${half}\`	((strings, f) => f(make()))\`\${below}\`	((strings, f) => f("4"))\`\${half}\`	((strings, f) => f("1"))\`\${below}\`
many-callers-and-an-impostor-through-an-array-element.js	[low][0](make())	[pick][0](make())	[low][0](4294967297.5)	[pick][0]("length")	[invoke][0](make())	[build][0](make())	[invoke][0](class {})	[build][0](() => {})	[sumOf][0](make())	[move][0](make())	[sumOf][0]({ y: 2, x: 1 })	[move][0]({ get x() { return 1; }, y: 2 })	[total][0](make())	[append][0](make())	[total][0]("12")	[append][0]({ push: () => "a literal's push" })	[firstCode][0](make())	[tail][0](make())	[firstCode][0]([65])	[tail][0]([1, 2, 3])	[half][0](make())	[below][0](make())	[half][0]("4")	[below][0]("1")
many-callers-and-an-impostor-through-call-bound-to-it.js	Function.prototype.call.bind(low)(undefined, make())	Function.prototype.call.bind(pick)(undefined, make())	Function.prototype.call.bind(low)(undefined, 4294967297.5)	Function.prototype.call.bind(pick)(undefined, "length")	Function.prototype.call.bind(invoke)(undefined, make())	Function.prototype.call.bind(build)(undefined, make())	Function.prototype.call.bind(invoke)(undefined, class {})	Function.prototype.call.bind(build)(undefined, () => {})	Function.prototype.call.bind(sumOf)(undefined, make())	Function.prototype.call.bind(move)(undefined, make())	Function.prototype.call.bind(sumOf)(undefined, { y: 2, x: 1 })	Function.prototype.call.bind(move)(undefined, { get x() { return 1; }, y: 2 })	Function.prototype.call.bind(total)(undefined, make())	Function.prototype.call.bind(append)(undefined, make())	Function.prototype.call.bind(total)(undefined, "12")	Function.prototype.call.bind(append)(undefined, { push: () => "a literal's push" })	Function.prototype.call.bind(firstCode)(undefined, make())	Function.prototype.call.bind(tail)(undefined, make())	Function.prototype.call.bind(firstCode)(undefined, [65])	Function.prototype.call.bind(tail)(undefined, [1, 2, 3])	Function.prototype.call.bind(half)(undefined, make())	Function.prototype.call.bind(below)(undefined, make())	Function.prototype.call.bind(half)(undefined, "4")	Function.prototype.call.bind(below)(undefined, "1")
many-callers-and-an-impostor-through-filter.js	[make()].filter(low).length	[make()].filter(pick).length	[4294967297.5].filter(low).length	["length"].filter(pick).length	[make()].filter(invoke).length	[make()].filter(build).length	[class {}].filter(invoke).length	[() => {}].filter(build).length	[make()].filter(sumOf).length	[make()].filter(move).length	[{ y: 2, x: 1 }].filter(sumOf).length	[{ get x() { return 1; }, y: 2 }].filter(move).length	[make()].filter(total).length	[make()].filter(append).length	["12"].filter(total).length	[{ push: () => "a literal's push" }].filter(append).length	[make()].filter(firstCode).length	[make()].filter(tail).length	[[65]].filter(firstCode).length	[[1, 2, 3]].filter(tail).length	[make()].filter(half).length	[make()].filter(below).length	["4"].filter(half).length	["1"].filter(below).length
many-callers-and-an-impostor-through-reflect-apply.js	Reflect.apply(low, undefined, [make()])	Reflect.apply(pick, undefined, [make()])	Reflect.apply(low, undefined, [4294967297.5])	Reflect.apply(pick, undefined, ["length"])	Reflect.apply(invoke, undefined, [make()])	Reflect.apply(build, undefined, [make()])	Reflect.apply(invoke, undefined, [class {}])	Reflect.apply(build, undefined, [() => {}])	Reflect.apply(sumOf, undefined, [make()])	Reflect.apply(move, undefined, [make()])	Reflect.apply(sumOf, undefined, [{ y: 2, x: 1 }])	Reflect.apply(move, undefined, [{ get x() { return 1; }, y: 2 }])	Reflect.apply(total, undefined, [make()])	Reflect.apply(append, undefined, [make()])	Reflect.apply(total, undefined, ["12"])	Reflect.apply(append, undefined, [{ push: () => "a literal's push" }])	Reflect.apply(firstCode, undefined, [make()])	Reflect.apply(tail, undefined, [make()])	Reflect.apply(firstCode, undefined, [[65]])	Reflect.apply(tail, undefined, [[1, 2, 3]])	Reflect.apply(half, undefined, [make()])	Reflect.apply(below, undefined, [make()])	Reflect.apply(half, undefined, ["4"])	Reflect.apply(below, undefined, ["1"])`,
      (a, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r, s, t, u, v, w, x, y) => `function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

let last;
const log = [];

function attempt(label, run) {
  last = "never set";
  log.length = 0;
  let line;
  try {
    line = "returned " + show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + ", last " + show(last) + (log.length ? ", log " + log.join(" ") : ""));
}

class Stack extends Array {
  push() {
    return "the subclass's push";
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

const letters = ["a", "b", "c", "d"];

function low(n) {
  return (last = n & 255);
}

function pick(i) {
  return (last = letters[i]);
}

function invoke(f) {
  return (last = f(2));
}

function build(f) {
  return (last = new f(2).value);
}

function sumOf(point) {
  return (last = point.x + point.y);
}

function move(point) {
  point.x = point.x + 1;
  return (last = point.x);
}

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function append(list) {
  return (last = list.push(4));
}

function firstCode(text) {
  return (last = text.charCodeAt(0));
}

function tail(text) {
  return (last = text.slice(1));
}

function half(n) {
  return (last = n / 2);
}

function below(n) {
  let steps = 0;
  while (n < 3) {
    n++;
    steps++;
  }
  return (last = steps);
}

const notSmallIntegers = [
  ["two to the 31st", () => 2147483648],
  ["past two to the 32nd", () => 4294967297],
  ["a fraction", () => 1.5],
  ["negative zero", () => -0],
  ["NaN", () => NaN],
  ["a numeric string", () => "1"],
  ["a name", () => "length"],
  ["an object", () => ({ valueOf: () => (log.push("valueOf"), 2), toString: () => (log.push("toString"), "3") })],
  ["a BigInt", () => 1n],
  ["undefined", () => undefined],
];

const notFunctions = [
  ["a class", () => class { constructor(v) { this.value = v; } }],
  ["an arrow function", () => v => ({ value: v })],
  ["a bound function", () => function (a, b) { this.value = [a, b]; return a + b; }.bind({}, 1)],
  ["a callable proxy", () => new Proxy(function () {}, { apply: (target, self, list) => (log.push("apply"), list[0]), construct: (target, list) => (log.push("construct"), { value: list[0] }) })],
  ["an async function", () => async v => v],
  ["an object with call and apply", () => ({ call: () => "call", apply: () => "apply" })],
  ["a string", () => "f"],
  ["undefined", () => undefined],
];

const notPoints = [
  ["the other key order", () => ({ y: 2, x: 1 })],
  ["a getter", () => ({ get x() { log.push("get x"); return 1; }, y: 2 })],
  ["accessors on the prototype", () => Object.create({ get x() { log.push("get x"); return 1; }, set x(v) { log.push("set x " + v); }, y: 2 })],
  ["a proxy", () => new Proxy({ x: 1, y: 2 }, { get: (target, key) => (log.push("get " + String(key)), target[key]), set: (target, key, v) => (log.push("set " + String(key)), (target[key] = v), true) })],
  ["y is missing", () => ({ x: 1 })],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["strings inside", () => ({ x: "1", y: "2" })],
  ["parsed JSON", () => JSON.parse('{"y":2,"x":1}')],
  ["a number", () => 5],
  ["null", () => null],
];

const notArrays = [
  ["a string", () => "12"],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a subclass", () => new Stack(1, 2)],
  ["a frozen array", () => Object.freeze([1, 2])],
  ["an array of holes", () => new Array(2)],
  ["parsed JSON", () => JSON.parse('{"0":5,"length":1}')],
  ["null", () => null],
];

const notStrings = [
  ["an array", () => ["a", "b"]],
  ["a String object", () => new String("ab")],
  ["an object with the methods", () => ({ charCodeAt: () => "a code", slice: () => "a slice" })],
  ["a Buffer", () => Buffer.from("ab")],
  ["a number", () => 65],
  ["undefined", () => undefined],
];

const notNumbers = [
  ["a numeric string", () => "1"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 1) })],
  ["an object with Symbol.toPrimitive", () => ({ [Symbol.toPrimitive]: hint => (log.push(hint), 2) })],
  ["a BigInt", () => 1n],
  ["an array of one", () => [1]],
  ["a symbol", () => Symbol("s")],
  ["negative zero", () => -0],
  ["null", () => null],
  ["undefined", () => undefined],
];

function honestFirst(round) {
  console.log(round, "low", low(1), low(256), low(-1), low(1023), low(0), low(65535));
  console.log(round, "invoke", invoke(v => v + 1), invoke(function (v) { return v * 2; }), invoke(v => -v), invoke(v => [v].length), invoke(function same(v) { return v; }), invoke(() => 0));
  console.log(round, "sumOf", sumOf({ x: 1, y: 2 }), sumOf({ x: 3, y: 4 }), sumOf(new Point(5, 6)), sumOf({ x: 0.5, y: 0.5 }), sumOf(new Point(-1, 1)), sumOf({ x: 7, y: 8 }));
  console.log(round, "total", total([1, 2, 3]), total([]), total([0.5, 0.25]), total(new Array(4, 5, 6)), total(Array.of(7, 8)), total([1, 2, 3, 4].slice(1)));
  console.log(round, "firstCode", firstCode("a"), firstCode("bc"), firstCode(""), firstCode("\\u00e9"), firstCode(\`t\${round}\`), firstCode(String(12)));
  console.log(round, "half", half(4), half(3), half(0.5), half(-8), half(1e21), half(0));
}

function honestSecond(round) {
  console.log(round, "pick", pick(0), pick(1), pick(2), pick(3), pick(1 + 1), pick(letters.length - 1));
  console.log(round, "build", build(class { constructor(v) { this.value = v; } }), build(function (v) { this.value = v * 2; }), build(class { value = 3; }), build(function () {}), build(class extends Point { get value() { return this.x; } }), build(function (v) { return { value: -v }; }));
  console.log(round, "move", move({ x: 1, y: 2 }), move({ x: 3, y: 4 }), move(new Point(5, 6)), move({ x: 0.5, y: 0.5 }), move(new Point(-1, 1)), move({ x: 7, y: 8 }));
  console.log(round, "append", append([1, 2, 3]), append([]), append(new Array(1, 2)), append(["a"]), append([[1], [2]]), append(Array.of(1, 2, 3, 4)));
  console.log(round, "tail", tail("abc"), tail(""), tail("x"), tail(\`t\${round}\`), tail("\\u00e9!"), tail(String(123)));
  console.log(round, "below", below(0), below(1), below(2.5), below(3), below(-1), below(10));
}

console.log("strict:", (function () { return this === undefined; })());
honestSecond("before");
for (const [name, make] of notSmallIntegers) {
  attempt("low of " + name, () => ${a});
  attempt("pick at " + name, () => ${b});
}
attempt("low of a literal", () => ${c});
attempt("pick at a literal", () => ${d});
for (const [name, make] of notFunctions) {
  attempt("invoke of " + name, () => ${e});
  attempt("build from " + name, () => ${f});
}
attempt("invoke of a literal", () => ${g});
attempt("build from a literal", () => ${h});
for (const [name, make] of notPoints) {
  attempt("sumOf " + name, () => ${i});
  attempt("move " + name, () => ${j});
}
attempt("sumOf a literal", () => ${k});
attempt("move a literal", () => ${l});
for (const [name, make] of notArrays) {
  attempt("total of " + name, () => ${m});
  attempt("append to " + name, () => ${o});
}
attempt("total of a literal", () => ${p});
attempt("append to a literal", () => ${q});
for (const [name, make] of notStrings) {
  attempt("firstCode of " + name, () => ${r});
  attempt("tail of " + name, () => ${s});
}
attempt("firstCode of a literal", () => ${t});
attempt("tail of a literal", () => ${u});
for (const [name, make] of notNumbers) {
  attempt("half of " + name, () => ${v});
  attempt("below from " + name, () => ${w});
}
attempt("half of a literal", () => ${x});
attempt("below from a literal", () => ${y});
honestFirst("after");
honestSecond("after");
`,
    ),
    ...family(
      `many-callers-and-an-impostor-through-a-class-field.js	new (class { run = sumOf; })().run(make())	new (class { run = move; })().run(make())	new (class { run = sumOf; })().run({ y: 2, x: 1 })	new (class { run = move; })().run({ get x() { return 1; }, y: 2 })	new (class { run = total; })().run(make())	new (class { run = append; })().run(make())	new (class { run = total; })().run("12")	new (class { run = append; })().run({ push: () => "a literal's push" })	new (class { run = firstCode; })().run(make())	new (class { run = tail; })().run(make())	new (class { run = firstCode; })().run([65])	new (class { run = tail; })().run([1, 2, 3])	new (class { run = half; })().run(make())	new (class { run = below; })().run(make())	new (class { run = half; })().run("4")	new (class { run = below; })().run("1")	new (class { run = low; })().run(make())	new (class { run = pick; })().run(make())	new (class { run = low; })().run(4294967297.5)	new (class { run = pick; })().run("length")	new (class { run = invoke; })().run(make())	new (class { run = build; })().run(make())	new (class { run = invoke; })().run(class {})	new (class { run = build; })().run(() => {})
many-callers-and-an-impostor-through-apply.js	sumOf.apply(undefined, [make()])	move.apply(undefined, [make()])	sumOf.apply(undefined, [{ y: 2, x: 1 }])	move.apply(undefined, [{ get x() { return 1; }, y: 2 }])	total.apply(undefined, [make()])	append.apply(undefined, [make()])	total.apply(undefined, ["12"])	append.apply(undefined, [{ push: () => "a literal's push" }])	firstCode.apply(undefined, [make()])	tail.apply(undefined, [make()])	firstCode.apply(undefined, [[65]])	tail.apply(undefined, [[1, 2, 3]])	half.apply(undefined, [make()])	below.apply(undefined, [make()])	half.apply(undefined, ["4"])	below.apply(undefined, ["1"])	low.apply(undefined, [make()])	pick.apply(undefined, [make()])	low.apply(undefined, [4294967297.5])	pick.apply(undefined, ["length"])	invoke.apply(undefined, [make()])	build.apply(undefined, [make()])	invoke.apply(undefined, [class {}])	build.apply(undefined, [() => {}])
many-callers-and-an-impostor-through-indirect-eval.js	{ globalThis.hiddenFunction = sumOf; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = move; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = sumOf; globalThis.hiddenValue = { y: 2, x: 1 }; return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = move; globalThis.hiddenValue = { get x() { return 1; }, y: 2 }; return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = total; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = append; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = total; globalThis.hiddenValue = "12"; return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = append; globalThis.hiddenValue = { push: () => "a literal's push" }; return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = firstCode; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = tail; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = firstCode; globalThis.hiddenValue = [65]; return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = tail; globalThis.hiddenValue = [1, 2, 3]; return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = half; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = below; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = half; globalThis.hiddenValue = "4"; return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = below; globalThis.hiddenValue = "1"; return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = low; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = pick; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = low; globalThis.hiddenValue = 4294967297.5; return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = pick; globalThis.hiddenValue = "length"; return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = invoke; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = build; globalThis.hiddenValue = make(); return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = invoke; globalThis.hiddenValue = class {}; return (0, eval)("hiddenFunction(hiddenValue)"); }	{ globalThis.hiddenFunction = build; globalThis.hiddenValue = () => {}; return (0, eval)("hiddenFunction(hiddenValue)"); }
many-callers-and-an-impostor-through-map.js	[make()].map(sumOf)[0]	[make()].map(move)[0]	[{ y: 2, x: 1 }].map(sumOf)[0]	[{ get x() { return 1; }, y: 2 }].map(move)[0]	[make()].map(total)[0]	[make()].map(append)[0]	["12"].map(total)[0]	[{ push: () => "a literal's push" }].map(append)[0]	[make()].map(firstCode)[0]	[make()].map(tail)[0]	[[65]].map(firstCode)[0]	[[1, 2, 3]].map(tail)[0]	[make()].map(half)[0]	[make()].map(below)[0]	["4"].map(half)[0]	["1"].map(below)[0]	[make()].map(low)[0]	[make()].map(pick)[0]	[4294967297.5].map(low)[0]	["length"].map(pick)[0]	[make()].map(invoke)[0]	[make()].map(build)[0]	[class {}].map(invoke)[0]	[() => {}].map(build)[0]
many-callers-and-an-impostor-through-new.js	new sumOf(make())	new move(make())	new sumOf({ y: 2, x: 1 })	new move({ get x() { return 1; }, y: 2 })	new total(make())	new append(make())	new total("12")	new append({ push: () => "a literal's push" })	new firstCode(make())	new tail(make())	new firstCode([65])	new tail([1, 2, 3])	new half(make())	new below(make())	new half("4")	new below("1")	new low(make())	new pick(make())	new low(4294967297.5)	new pick("length")	new invoke(make())	new build(make())	new invoke(class {})	new build(() => {})
many-callers-and-an-impostor-through-pop.js	[sumOf].pop()(make())	[move].pop()(make())	[sumOf].pop()({ y: 2, x: 1 })	[move].pop()({ get x() { return 1; }, y: 2 })	[total].pop()(make())	[append].pop()(make())	[total].pop()("12")	[append].pop()({ push: () => "a literal's push" })	[firstCode].pop()(make())	[tail].pop()(make())	[firstCode].pop()([65])	[tail].pop()([1, 2, 3])	[half].pop()(make())	[below].pop()(make())	[half].pop()("4")	[below].pop()("1")	[low].pop()(make())	[pick].pop()(make())	[low].pop()(4294967297.5)	[pick].pop()("length")	[invoke].pop()(make())	[build].pop()(make())	[invoke].pop()(class {})	[build].pop()(() => {})
many-callers-and-an-impostor-through-reflect-apply-bound-to-it.js	Reflect.apply.bind(null, sumOf, undefined)([make()])	Reflect.apply.bind(null, move, undefined)([make()])	Reflect.apply.bind(null, sumOf, undefined)([{ y: 2, x: 1 }])	Reflect.apply.bind(null, move, undefined)([{ get x() { return 1; }, y: 2 }])	Reflect.apply.bind(null, total, undefined)([make()])	Reflect.apply.bind(null, append, undefined)([make()])	Reflect.apply.bind(null, total, undefined)(["12"])	Reflect.apply.bind(null, append, undefined)([{ push: () => "a literal's push" }])	Reflect.apply.bind(null, firstCode, undefined)([make()])	Reflect.apply.bind(null, tail, undefined)([make()])	Reflect.apply.bind(null, firstCode, undefined)([[65]])	Reflect.apply.bind(null, tail, undefined)([[1, 2, 3]])	Reflect.apply.bind(null, half, undefined)([make()])	Reflect.apply.bind(null, below, undefined)([make()])	Reflect.apply.bind(null, half, undefined)(["4"])	Reflect.apply.bind(null, below, undefined)(["1"])	Reflect.apply.bind(null, low, undefined)([make()])	Reflect.apply.bind(null, pick, undefined)([make()])	Reflect.apply.bind(null, low, undefined)([4294967297.5])	Reflect.apply.bind(null, pick, undefined)(["length"])	Reflect.apply.bind(null, invoke, undefined)([make()])	Reflect.apply.bind(null, build, undefined)([make()])	Reflect.apply.bind(null, invoke, undefined)([class {}])	Reflect.apply.bind(null, build, undefined)([() => {}])
many-callers-and-an-impostor-through-reflect-get.js	Reflect.get({ run: sumOf }, "run")(make())	Reflect.get({ run: move }, "run")(make())	Reflect.get({ run: sumOf }, "run")({ y: 2, x: 1 })	Reflect.get({ run: move }, "run")({ get x() { return 1; }, y: 2 })	Reflect.get({ run: total }, "run")(make())	Reflect.get({ run: append }, "run")(make())	Reflect.get({ run: total }, "run")("12")	Reflect.get({ run: append }, "run")({ push: () => "a literal's push" })	Reflect.get({ run: firstCode }, "run")(make())	Reflect.get({ run: tail }, "run")(make())	Reflect.get({ run: firstCode }, "run")([65])	Reflect.get({ run: tail }, "run")([1, 2, 3])	Reflect.get({ run: half }, "run")(make())	Reflect.get({ run: below }, "run")(make())	Reflect.get({ run: half }, "run")("4")	Reflect.get({ run: below }, "run")("1")	Reflect.get({ run: low }, "run")(make())	Reflect.get({ run: pick }, "run")(make())	Reflect.get({ run: low }, "run")(4294967297.5)	Reflect.get({ run: pick }, "run")("length")	Reflect.get({ run: invoke }, "run")(make())	Reflect.get({ run: build }, "run")(make())	Reflect.get({ run: invoke }, "run")(class {})	Reflect.get({ run: build }, "run")(() => {})
many-callers-and-an-impostor-through-the-for-each-of-a-map.js	new Map([["key", make()]]).forEach(sumOf)	new Map([["key", make()]]).forEach(move)	new Map([["key", { y: 2, x: 1 }]]).forEach(sumOf)	new Map([["key", { get x() { return 1; }, y: 2 }]]).forEach(move)	new Map([["key", make()]]).forEach(total)	new Map([["key", make()]]).forEach(append)	new Map([["key", "12"]]).forEach(total)	new Map([["key", { push: () => "a literal's push" }]]).forEach(append)	new Map([["key", make()]]).forEach(firstCode)	new Map([["key", make()]]).forEach(tail)	new Map([["key", [65]]]).forEach(firstCode)	new Map([["key", [1, 2, 3]]]).forEach(tail)	new Map([["key", make()]]).forEach(half)	new Map([["key", make()]]).forEach(below)	new Map([["key", "4"]]).forEach(half)	new Map([["key", "1"]]).forEach(below)	new Map([["key", make()]]).forEach(low)	new Map([["key", make()]]).forEach(pick)	new Map([["key", 4294967297.5]]).forEach(low)	new Map([["key", "length"]]).forEach(pick)	new Map([["key", make()]]).forEach(invoke)	new Map([["key", make()]]).forEach(build)	new Map([["key", class {}]]).forEach(invoke)	new Map([["key", () => {}]]).forEach(build)`,
      (a, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r, s, t, u, v, w, x, y) => `function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

let last;
const log = [];

function attempt(label, run) {
  last = "never set";
  log.length = 0;
  let line;
  try {
    line = "returned " + show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + ", last " + show(last) + (log.length ? ", log " + log.join(" ") : ""));
}

class Stack extends Array {
  push() {
    return "the subclass's push";
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function sumOf(point) {
  return (last = point.x + point.y);
}

function move(point) {
  point.x = point.x + 1;
  return (last = point.x);
}

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function append(list) {
  return (last = list.push(4));
}

function firstCode(text) {
  return (last = text.charCodeAt(0));
}

function tail(text) {
  return (last = text.slice(1));
}

function half(n) {
  return (last = n / 2);
}

function below(n) {
  let steps = 0;
  while (n < 3) {
    n++;
    steps++;
  }
  return (last = steps);
}

const letters = ["a", "b", "c", "d"];

function low(n) {
  return (last = n & 255);
}

function pick(i) {
  return (last = letters[i]);
}

function invoke(f) {
  return (last = f(2));
}

function build(f) {
  return (last = new f(2).value);
}

const notPoints = [
  ["the other key order", () => ({ y: 2, x: 1 })],
  ["a getter", () => ({ get x() { log.push("get x"); return 1; }, y: 2 })],
  ["accessors on the prototype", () => Object.create({ get x() { log.push("get x"); return 1; }, set x(v) { log.push("set x " + v); }, y: 2 })],
  ["a proxy", () => new Proxy({ x: 1, y: 2 }, { get: (target, key) => (log.push("get " + String(key)), target[key]), set: (target, key, v) => (log.push("set " + String(key)), (target[key] = v), true) })],
  ["y is missing", () => ({ x: 1 })],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["strings inside", () => ({ x: "1", y: "2" })],
  ["parsed JSON", () => JSON.parse('{"y":2,"x":1}')],
  ["a number", () => 5],
  ["null", () => null],
];

const notArrays = [
  ["a string", () => "12"],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a subclass", () => new Stack(1, 2)],
  ["a frozen array", () => Object.freeze([1, 2])],
  ["an array of holes", () => new Array(2)],
  ["parsed JSON", () => JSON.parse('{"0":5,"length":1}')],
  ["null", () => null],
];

const notStrings = [
  ["an array", () => ["a", "b"]],
  ["a String object", () => new String("ab")],
  ["an object with the methods", () => ({ charCodeAt: () => "a code", slice: () => "a slice" })],
  ["a Buffer", () => Buffer.from("ab")],
  ["a number", () => 65],
  ["undefined", () => undefined],
];

const notNumbers = [
  ["a numeric string", () => "1"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 1) })],
  ["an object with Symbol.toPrimitive", () => ({ [Symbol.toPrimitive]: hint => (log.push(hint), 2) })],
  ["a BigInt", () => 1n],
  ["an array of one", () => [1]],
  ["a symbol", () => Symbol("s")],
  ["negative zero", () => -0],
  ["null", () => null],
  ["undefined", () => undefined],
];

const notSmallIntegers = [
  ["two to the 31st", () => 2147483648],
  ["past two to the 32nd", () => 4294967297],
  ["a fraction", () => 1.5],
  ["negative zero", () => -0],
  ["NaN", () => NaN],
  ["a numeric string", () => "1"],
  ["a name", () => "length"],
  ["an object", () => ({ valueOf: () => (log.push("valueOf"), 2), toString: () => (log.push("toString"), "3") })],
  ["a BigInt", () => 1n],
  ["undefined", () => undefined],
];

const notFunctions = [
  ["a class", () => class { constructor(v) { this.value = v; } }],
  ["an arrow function", () => v => ({ value: v })],
  ["a bound function", () => function (a, b) { this.value = [a, b]; return a + b; }.bind({}, 1)],
  ["a callable proxy", () => new Proxy(function () {}, { apply: (target, self, list) => (log.push("apply"), list[0]), construct: (target, list) => (log.push("construct"), { value: list[0] }) })],
  ["an async function", () => async v => v],
  ["an object with call and apply", () => ({ call: () => "call", apply: () => "apply" })],
  ["a string", () => "f"],
  ["undefined", () => undefined],
];

function honestFirst(round) {
  console.log(round, "sumOf", sumOf({ x: 1, y: 2 }), sumOf({ x: 3, y: 4 }), sumOf(new Point(5, 6)), sumOf({ x: 0.5, y: 0.5 }), sumOf(new Point(-1, 1)), sumOf({ x: 7, y: 8 }));
  console.log(round, "total", total([1, 2, 3]), total([]), total([0.5, 0.25]), total(new Array(4, 5, 6)), total(Array.of(7, 8)), total([1, 2, 3, 4].slice(1)));
  console.log(round, "firstCode", firstCode("a"), firstCode("bc"), firstCode(""), firstCode("\\u00e9"), firstCode(\`t\${round}\`), firstCode(String(12)));
  console.log(round, "half", half(4), half(3), half(0.5), half(-8), half(1e21), half(0));
  console.log(round, "low", low(1), low(256), low(-1), low(1023), low(0), low(65535));
  console.log(round, "invoke", invoke(v => v + 1), invoke(function (v) { return v * 2; }), invoke(v => -v), invoke(v => [v].length), invoke(function same(v) { return v; }), invoke(() => 0));
}

function honestSecond(round) {
  console.log(round, "move", move({ x: 1, y: 2 }), move({ x: 3, y: 4 }), move(new Point(5, 6)), move({ x: 0.5, y: 0.5 }), move(new Point(-1, 1)), move({ x: 7, y: 8 }));
  console.log(round, "append", append([1, 2, 3]), append([]), append(new Array(1, 2)), append(["a"]), append([[1], [2]]), append(Array.of(1, 2, 3, 4)));
  console.log(round, "tail", tail("abc"), tail(""), tail("x"), tail(\`t\${round}\`), tail("\\u00e9!"), tail(String(123)));
  console.log(round, "below", below(0), below(1), below(2.5), below(3), below(-1), below(10));
  console.log(round, "pick", pick(0), pick(1), pick(2), pick(3), pick(1 + 1), pick(letters.length - 1));
  console.log(round, "build", build(class { constructor(v) { this.value = v; } }), build(function (v) { this.value = v * 2; }), build(class { value = 3; }), build(function () {}), build(class extends Point { get value() { return this.x; } }), build(function (v) { return { value: -v }; }));
}

console.log("strict:", (function () { return this === undefined; })());
honestSecond("before");
for (const [name, make] of notPoints) {
  attempt("sumOf " + name, () => ${a});
  attempt("move " + name, () => ${b});
}
attempt("sumOf a literal", () => ${c});
attempt("move a literal", () => ${d});
for (const [name, make] of notArrays) {
  attempt("total of " + name, () => ${e});
  attempt("append to " + name, () => ${f});
}
attempt("total of a literal", () => ${g});
attempt("append to a literal", () => ${h});
for (const [name, make] of notStrings) {
  attempt("firstCode of " + name, () => ${i});
  attempt("tail of " + name, () => ${j});
}
attempt("firstCode of a literal", () => ${k});
attempt("tail of a literal", () => ${l});
for (const [name, make] of notNumbers) {
  attempt("half of " + name, () => ${m});
  attempt("below from " + name, () => ${o});
}
attempt("half of a literal", () => ${p});
attempt("below from a literal", () => ${q});
for (const [name, make] of notSmallIntegers) {
  attempt("low of " + name, () => ${r});
  attempt("pick at " + name, () => ${s});
}
attempt("low of a literal", () => ${t});
attempt("pick at a literal", () => ${u});
for (const [name, make] of notFunctions) {
  attempt("invoke of " + name, () => ${v});
  attempt("build from " + name, () => ${w});
}
attempt("invoke of a literal", () => ${x});
attempt("build from a literal", () => ${y});
honestFirst("after");
honestSecond("after");
`,
    ),
    ...family(
      `many-callers-and-an-impostor-through-a-default-parameter.js	((f = firstCode) => f(make()))()	((f = tail) => f(make()))()	((f = firstCode) => f([65]))()	((f = tail) => f([1, 2, 3]))()	((f = half) => f(make()))()	((f = below) => f(make()))()	((f = half) => f("4"))()	((f = below) => f("1"))()	((f = low) => f(make()))()	((f = pick) => f(make()))()	((f = low) => f(4294967297.5))()	((f = pick) => f("length"))()	((f = invoke) => f(make()))()	((f = build) => f(make()))()	((f = invoke) => f(class {}))()	((f = build) => f(() => {}))()	((f = sumOf) => f(make()))()	((f = move) => f(make()))()	((f = sumOf) => f({ y: 2, x: 1 }))()	((f = move) => f({ get x() { return 1; }, y: 2 }))()	((f = total) => f(make()))()	((f = append) => f(make()))()	((f = total) => f("12"))()	((f = append) => f({ push: () => "a literal's push" }))()
many-callers-and-an-impostor-through-a-getter-that-returns-it.js	({ get run() { return firstCode; } }).run(make())	({ get run() { return tail; } }).run(make())	({ get run() { return firstCode; } }).run([65])	({ get run() { return tail; } }).run([1, 2, 3])	({ get run() { return half; } }).run(make())	({ get run() { return below; } }).run(make())	({ get run() { return half; } }).run("4")	({ get run() { return below; } }).run("1")	({ get run() { return low; } }).run(make())	({ get run() { return pick; } }).run(make())	({ get run() { return low; } }).run(4294967297.5)	({ get run() { return pick; } }).run("length")	({ get run() { return invoke; } }).run(make())	({ get run() { return build; } }).run(make())	({ get run() { return invoke; } }).run(class {})	({ get run() { return build; } }).run(() => {})	({ get run() { return sumOf; } }).run(make())	({ get run() { return move; } }).run(make())	({ get run() { return sumOf; } }).run({ y: 2, x: 1 })	({ get run() { return move; } }).run({ get x() { return 1; }, y: 2 })	({ get run() { return total; } }).run(make())	({ get run() { return append; } }).run(make())	({ get run() { return total; } }).run("12")	({ get run() { return append; } }).run({ push: () => "a literal's push" })
many-callers-and-an-impostor-through-a-sort-comparator.js	[make(), make()].sort(firstCode).length	[make(), make()].sort(tail).length	[[65], [65]].sort(firstCode).length	[[1, 2, 3], [1, 2, 3]].sort(tail).length	[make(), make()].sort(half).length	[make(), make()].sort(below).length	["4", "4"].sort(half).length	["1", "1"].sort(below).length	[make(), make()].sort(low).length	[make(), make()].sort(pick).length	[4294967297.5, 4294967297.5].sort(low).length	["length", "length"].sort(pick).length	[make(), make()].sort(invoke).length	[make(), make()].sort(build).length	[class {}, class {}].sort(invoke).length	[() => {}, () => {}].sort(build).length	[make(), make()].sort(sumOf).length	[make(), make()].sort(move).length	[{ y: 2, x: 1 }, { y: 2, x: 1 }].sort(sumOf).length	[{ get x() { return 1; }, y: 2 }, { get x() { return 1; }, y: 2 }].sort(move).length	[make(), make()].sort(total).length	[make(), make()].sort(append).length	["12", "12"].sort(total).length	[{ push: () => "a literal's push" }, { push: () => "a literal's push" }].sort(append).length
many-callers-and-an-impostor-through-a-spread-argument.js	firstCode(...[make()])	tail(...[make()])	firstCode(...[[65]])	tail(...[[1, 2, 3]])	half(...[make()])	below(...[make()])	half(...["4"])	below(...["1"])	low(...[make()])	pick(...[make()])	low(...[4294967297.5])	pick(...["length"])	invoke(...[make()])	build(...[make()])	invoke(...[class {}])	build(...[() => {}])	sumOf(...[make()])	move(...[make()])	sumOf(...[{ y: 2, x: 1 }])	move(...[{ get x() { return 1; }, y: 2 }])	total(...[make()])	append(...[make()])	total(...["12"])	append(...[{ push: () => "a literal's push" }])
many-callers-and-an-impostor-through-a-subclass-constructor.js	new (class extends firstCode {})(make())	new (class extends tail {})(make())	new (class extends firstCode {})([65])	new (class extends tail {})([1, 2, 3])	new (class extends half {})(make())	new (class extends below {})(make())	new (class extends half {})("4")	new (class extends below {})("1")	new (class extends low {})(make())	new (class extends pick {})(make())	new (class extends low {})(4294967297.5)	new (class extends pick {})("length")	new (class extends invoke {})(make())	new (class extends build {})(make())	new (class extends invoke {})(class {})	new (class extends build {})(() => {})	new (class extends sumOf {})(make())	new (class extends move {})(make())	new (class extends sumOf {})({ y: 2, x: 1 })	new (class extends move {})({ get x() { return 1; }, y: 2 })	new (class extends total {})(make())	new (class extends append {})(make())	new (class extends total {})("12")	new (class extends append {})({ push: () => "a literal's push" })
many-callers-and-an-impostor-through-a-symbol-key.js	({ [Symbol.for("run")]: firstCode })[Symbol.for("run")](make())	({ [Symbol.for("run")]: tail })[Symbol.for("run")](make())	({ [Symbol.for("run")]: firstCode })[Symbol.for("run")]([65])	({ [Symbol.for("run")]: tail })[Symbol.for("run")]([1, 2, 3])	({ [Symbol.for("run")]: half })[Symbol.for("run")](make())	({ [Symbol.for("run")]: below })[Symbol.for("run")](make())	({ [Symbol.for("run")]: half })[Symbol.for("run")]("4")	({ [Symbol.for("run")]: below })[Symbol.for("run")]("1")	({ [Symbol.for("run")]: low })[Symbol.for("run")](make())	({ [Symbol.for("run")]: pick })[Symbol.for("run")](make())	({ [Symbol.for("run")]: low })[Symbol.for("run")](4294967297.5)	({ [Symbol.for("run")]: pick })[Symbol.for("run")]("length")	({ [Symbol.for("run")]: invoke })[Symbol.for("run")](make())	({ [Symbol.for("run")]: build })[Symbol.for("run")](make())	({ [Symbol.for("run")]: invoke })[Symbol.for("run")](class {})	({ [Symbol.for("run")]: build })[Symbol.for("run")](() => {})	({ [Symbol.for("run")]: sumOf })[Symbol.for("run")](make())	({ [Symbol.for("run")]: move })[Symbol.for("run")](make())	({ [Symbol.for("run")]: sumOf })[Symbol.for("run")]({ y: 2, x: 1 })	({ [Symbol.for("run")]: move })[Symbol.for("run")]({ get x() { return 1; }, y: 2 })	({ [Symbol.for("run")]: total })[Symbol.for("run")](make())	({ [Symbol.for("run")]: append })[Symbol.for("run")](make())	({ [Symbol.for("run")]: total })[Symbol.for("run")]("12")	({ [Symbol.for("run")]: append })[Symbol.for("run")]({ push: () => "a literal's push" })
many-callers-and-an-impostor-through-a-weak-reference.js	new WeakRef(firstCode).deref()(make())	new WeakRef(tail).deref()(make())	new WeakRef(firstCode).deref()([65])	new WeakRef(tail).deref()([1, 2, 3])	new WeakRef(half).deref()(make())	new WeakRef(below).deref()(make())	new WeakRef(half).deref()("4")	new WeakRef(below).deref()("1")	new WeakRef(low).deref()(make())	new WeakRef(pick).deref()(make())	new WeakRef(low).deref()(4294967297.5)	new WeakRef(pick).deref()("length")	new WeakRef(invoke).deref()(make())	new WeakRef(build).deref()(make())	new WeakRef(invoke).deref()(class {})	new WeakRef(build).deref()(() => {})	new WeakRef(sumOf).deref()(make())	new WeakRef(move).deref()(make())	new WeakRef(sumOf).deref()({ y: 2, x: 1 })	new WeakRef(move).deref()({ get x() { return 1; }, y: 2 })	new WeakRef(total).deref()(make())	new WeakRef(append).deref()(make())	new WeakRef(total).deref()("12")	new WeakRef(append).deref()({ push: () => "a literal's push" })
many-callers-and-an-impostor-through-bind.js	firstCode.bind(undefined)(make())	tail.bind(undefined)(make())	firstCode.bind(undefined)([65])	tail.bind(undefined)([1, 2, 3])	half.bind(undefined)(make())	below.bind(undefined)(make())	half.bind(undefined)("4")	below.bind(undefined)("1")	low.bind(undefined)(make())	pick.bind(undefined)(make())	low.bind(undefined)(4294967297.5)	pick.bind(undefined)("length")	invoke.bind(undefined)(make())	build.bind(undefined)(make())	invoke.bind(undefined)(class {})	build.bind(undefined)(() => {})	sumOf.bind(undefined)(make())	move.bind(undefined)(make())	sumOf.bind(undefined)({ y: 2, x: 1 })	move.bind(undefined)({ get x() { return 1; }, y: 2 })	total.bind(undefined)(make())	append.bind(undefined)(make())	total.bind(undefined)("12")	append.bind(undefined)({ push: () => "a literal's push" })
many-callers-and-an-impostor-through-its-call-applied.js	firstCode.call.apply(firstCode, [undefined, make()])	tail.call.apply(tail, [undefined, make()])	firstCode.call.apply(firstCode, [undefined, [65]])	tail.call.apply(tail, [undefined, [1, 2, 3]])	half.call.apply(half, [undefined, make()])	below.call.apply(below, [undefined, make()])	half.call.apply(half, [undefined, "4"])	below.call.apply(below, [undefined, "1"])	low.call.apply(low, [undefined, make()])	pick.call.apply(pick, [undefined, make()])	low.call.apply(low, [undefined, 4294967297.5])	pick.call.apply(pick, [undefined, "length"])	invoke.call.apply(invoke, [undefined, make()])	build.call.apply(build, [undefined, make()])	invoke.call.apply(invoke, [undefined, class {}])	build.call.apply(build, [undefined, () => {}])	sumOf.call.apply(sumOf, [undefined, make()])	move.call.apply(move, [undefined, make()])	sumOf.call.apply(sumOf, [undefined, { y: 2, x: 1 }])	move.call.apply(move, [undefined, { get x() { return 1; }, y: 2 }])	total.call.apply(total, [undefined, make()])	append.call.apply(append, [undefined, make()])	total.call.apply(total, [undefined, "12"])	append.call.apply(append, [undefined, { push: () => "a literal's push" }])
many-callers-and-an-impostor-through-symbol-has-instance.js	(make()) instanceof { [Symbol.hasInstance]: firstCode }	(make()) instanceof { [Symbol.hasInstance]: tail }	([65]) instanceof { [Symbol.hasInstance]: firstCode }	([1, 2, 3]) instanceof { [Symbol.hasInstance]: tail }	(make()) instanceof { [Symbol.hasInstance]: half }	(make()) instanceof { [Symbol.hasInstance]: below }	("4") instanceof { [Symbol.hasInstance]: half }	("1") instanceof { [Symbol.hasInstance]: below }	(make()) instanceof { [Symbol.hasInstance]: low }	(make()) instanceof { [Symbol.hasInstance]: pick }	(4294967297.5) instanceof { [Symbol.hasInstance]: low }	("length") instanceof { [Symbol.hasInstance]: pick }	(make()) instanceof { [Symbol.hasInstance]: invoke }	(make()) instanceof { [Symbol.hasInstance]: build }	(class {}) instanceof { [Symbol.hasInstance]: invoke }	(() => {}) instanceof { [Symbol.hasInstance]: build }	(make()) instanceof { [Symbol.hasInstance]: sumOf }	(make()) instanceof { [Symbol.hasInstance]: move }	({ y: 2, x: 1 }) instanceof { [Symbol.hasInstance]: sumOf }	({ get x() { return 1; }, y: 2 }) instanceof { [Symbol.hasInstance]: move }	(make()) instanceof { [Symbol.hasInstance]: total }	(make()) instanceof { [Symbol.hasInstance]: append }	("12") instanceof { [Symbol.hasInstance]: total }	({ push: () => "a literal's push" }) instanceof { [Symbol.hasInstance]: append }
many-callers-and-an-impostor-through-the-arguments-object.js	(function () { return arguments[0](arguments[1]); })(firstCode, make())	(function () { return arguments[0](arguments[1]); })(tail, make())	(function () { return arguments[0](arguments[1]); })(firstCode, [65])	(function () { return arguments[0](arguments[1]); })(tail, [1, 2, 3])	(function () { return arguments[0](arguments[1]); })(half, make())	(function () { return arguments[0](arguments[1]); })(below, make())	(function () { return arguments[0](arguments[1]); })(half, "4")	(function () { return arguments[0](arguments[1]); })(below, "1")	(function () { return arguments[0](arguments[1]); })(low, make())	(function () { return arguments[0](arguments[1]); })(pick, make())	(function () { return arguments[0](arguments[1]); })(low, 4294967297.5)	(function () { return arguments[0](arguments[1]); })(pick, "length")	(function () { return arguments[0](arguments[1]); })(invoke, make())	(function () { return arguments[0](arguments[1]); })(build, make())	(function () { return arguments[0](arguments[1]); })(invoke, class {})	(function () { return arguments[0](arguments[1]); })(build, () => {})	(function () { return arguments[0](arguments[1]); })(sumOf, make())	(function () { return arguments[0](arguments[1]); })(move, make())	(function () { return arguments[0](arguments[1]); })(sumOf, { y: 2, x: 1 })	(function () { return arguments[0](arguments[1]); })(move, { get x() { return 1; }, y: 2 })	(function () { return arguments[0](arguments[1]); })(total, make())	(function () { return arguments[0](arguments[1]); })(append, make())	(function () { return arguments[0](arguments[1]); })(total, "12")	(function () { return arguments[0](arguments[1]); })(append, { push: () => "a literal's push" })`,
      (a, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r, s, t, u, v, w, x, y) => `function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

let last;
const log = [];

function attempt(label, run) {
  last = "never set";
  log.length = 0;
  let line;
  try {
    line = "returned " + show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + ", last " + show(last) + (log.length ? ", log " + log.join(" ") : ""));
}

class Stack extends Array {
  push() {
    return "the subclass's push";
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function firstCode(text) {
  return (last = text.charCodeAt(0));
}

function tail(text) {
  return (last = text.slice(1));
}

function half(n) {
  return (last = n / 2);
}

function below(n) {
  let steps = 0;
  while (n < 3) {
    n++;
    steps++;
  }
  return (last = steps);
}

const letters = ["a", "b", "c", "d"];

function low(n) {
  return (last = n & 255);
}

function pick(i) {
  return (last = letters[i]);
}

function invoke(f) {
  return (last = f(2));
}

function build(f) {
  return (last = new f(2).value);
}

function sumOf(point) {
  return (last = point.x + point.y);
}

function move(point) {
  point.x = point.x + 1;
  return (last = point.x);
}

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function append(list) {
  return (last = list.push(4));
}

const notStrings = [
  ["an array", () => ["a", "b"]],
  ["a String object", () => new String("ab")],
  ["an object with the methods", () => ({ charCodeAt: () => "a code", slice: () => "a slice" })],
  ["a Buffer", () => Buffer.from("ab")],
  ["a number", () => 65],
  ["undefined", () => undefined],
];

const notNumbers = [
  ["a numeric string", () => "1"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 1) })],
  ["an object with Symbol.toPrimitive", () => ({ [Symbol.toPrimitive]: hint => (log.push(hint), 2) })],
  ["a BigInt", () => 1n],
  ["an array of one", () => [1]],
  ["a symbol", () => Symbol("s")],
  ["negative zero", () => -0],
  ["null", () => null],
  ["undefined", () => undefined],
];

const notSmallIntegers = [
  ["two to the 31st", () => 2147483648],
  ["past two to the 32nd", () => 4294967297],
  ["a fraction", () => 1.5],
  ["negative zero", () => -0],
  ["NaN", () => NaN],
  ["a numeric string", () => "1"],
  ["a name", () => "length"],
  ["an object", () => ({ valueOf: () => (log.push("valueOf"), 2), toString: () => (log.push("toString"), "3") })],
  ["a BigInt", () => 1n],
  ["undefined", () => undefined],
];

const notFunctions = [
  ["a class", () => class { constructor(v) { this.value = v; } }],
  ["an arrow function", () => v => ({ value: v })],
  ["a bound function", () => function (a, b) { this.value = [a, b]; return a + b; }.bind({}, 1)],
  ["a callable proxy", () => new Proxy(function () {}, { apply: (target, self, list) => (log.push("apply"), list[0]), construct: (target, list) => (log.push("construct"), { value: list[0] }) })],
  ["an async function", () => async v => v],
  ["an object with call and apply", () => ({ call: () => "call", apply: () => "apply" })],
  ["a string", () => "f"],
  ["undefined", () => undefined],
];

const notPoints = [
  ["the other key order", () => ({ y: 2, x: 1 })],
  ["a getter", () => ({ get x() { log.push("get x"); return 1; }, y: 2 })],
  ["accessors on the prototype", () => Object.create({ get x() { log.push("get x"); return 1; }, set x(v) { log.push("set x " + v); }, y: 2 })],
  ["a proxy", () => new Proxy({ x: 1, y: 2 }, { get: (target, key) => (log.push("get " + String(key)), target[key]), set: (target, key, v) => (log.push("set " + String(key)), (target[key] = v), true) })],
  ["y is missing", () => ({ x: 1 })],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["strings inside", () => ({ x: "1", y: "2" })],
  ["parsed JSON", () => JSON.parse('{"y":2,"x":1}')],
  ["a number", () => 5],
  ["null", () => null],
];

const notArrays = [
  ["a string", () => "12"],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a subclass", () => new Stack(1, 2)],
  ["a frozen array", () => Object.freeze([1, 2])],
  ["an array of holes", () => new Array(2)],
  ["parsed JSON", () => JSON.parse('{"0":5,"length":1}')],
  ["null", () => null],
];

function honestFirst(round) {
  console.log(round, "firstCode", firstCode("a"), firstCode("bc"), firstCode(""), firstCode("\\u00e9"), firstCode(\`t\${round}\`), firstCode(String(12)));
  console.log(round, "half", half(4), half(3), half(0.5), half(-8), half(1e21), half(0));
  console.log(round, "low", low(1), low(256), low(-1), low(1023), low(0), low(65535));
  console.log(round, "invoke", invoke(v => v + 1), invoke(function (v) { return v * 2; }), invoke(v => -v), invoke(v => [v].length), invoke(function same(v) { return v; }), invoke(() => 0));
  console.log(round, "sumOf", sumOf({ x: 1, y: 2 }), sumOf({ x: 3, y: 4 }), sumOf(new Point(5, 6)), sumOf({ x: 0.5, y: 0.5 }), sumOf(new Point(-1, 1)), sumOf({ x: 7, y: 8 }));
  console.log(round, "total", total([1, 2, 3]), total([]), total([0.5, 0.25]), total(new Array(4, 5, 6)), total(Array.of(7, 8)), total([1, 2, 3, 4].slice(1)));
}

function honestSecond(round) {
  console.log(round, "tail", tail("abc"), tail(""), tail("x"), tail(\`t\${round}\`), tail("\\u00e9!"), tail(String(123)));
  console.log(round, "below", below(0), below(1), below(2.5), below(3), below(-1), below(10));
  console.log(round, "pick", pick(0), pick(1), pick(2), pick(3), pick(1 + 1), pick(letters.length - 1));
  console.log(round, "build", build(class { constructor(v) { this.value = v; } }), build(function (v) { this.value = v * 2; }), build(class { value = 3; }), build(function () {}), build(class extends Point { get value() { return this.x; } }), build(function (v) { return { value: -v }; }));
  console.log(round, "move", move({ x: 1, y: 2 }), move({ x: 3, y: 4 }), move(new Point(5, 6)), move({ x: 0.5, y: 0.5 }), move(new Point(-1, 1)), move({ x: 7, y: 8 }));
  console.log(round, "append", append([1, 2, 3]), append([]), append(new Array(1, 2)), append(["a"]), append([[1], [2]]), append(Array.of(1, 2, 3, 4)));
}

console.log("strict:", (function () { return this === undefined; })());
honestSecond("before");
for (const [name, make] of notStrings) {
  attempt("firstCode of " + name, () => ${a});
  attempt("tail of " + name, () => ${b});
}
attempt("firstCode of a literal", () => ${c});
attempt("tail of a literal", () => ${d});
for (const [name, make] of notNumbers) {
  attempt("half of " + name, () => ${e});
  attempt("below from " + name, () => ${f});
}
attempt("half of a literal", () => ${g});
attempt("below from a literal", () => ${h});
for (const [name, make] of notSmallIntegers) {
  attempt("low of " + name, () => ${i});
  attempt("pick at " + name, () => ${j});
}
attempt("low of a literal", () => ${k});
attempt("pick at a literal", () => ${l});
for (const [name, make] of notFunctions) {
  attempt("invoke of " + name, () => ${m});
  attempt("build from " + name, () => ${o});
}
attempt("invoke of a literal", () => ${p});
attempt("build from a literal", () => ${q});
for (const [name, make] of notPoints) {
  attempt("sumOf " + name, () => ${r});
  attempt("move " + name, () => ${s});
}
attempt("sumOf a literal", () => ${t});
attempt("move a literal", () => ${u});
for (const [name, make] of notArrays) {
  attempt("total of " + name, () => ${v});
  attempt("append to " + name, () => ${w});
}
attempt("total of a literal", () => ${x});
attempt("append to a literal", () => ${y});
honestFirst("after");
honestSecond("after");
`,
    ),
    ...family(
      `numbers/a-parameter-that-is-not-a-number-is-updated-by-bit-operators.js	or	|= 0	and	&= 255	xorAssig	^= 1	orAssign, andAssign, xorAssig
numbers/a-parameter-that-is-not-a-number-is-updated-by-remainder-and-power.js	remainder	%= 3	power	**= 2	plusAssignAFractio	+= 0.5	remainderAssign, powerAssign, plusAssignAFractio
numbers/a-parameter-that-is-not-a-number-is-updated-by-shifts.js	shiftLeft	<<= 1	shiftRight	>>= 1	shiftRightUnsignedAssig	>>>= 0	shiftLeftAssign, shiftRightAssign, shiftRightUnsignedAssig`,
      (a, b, c, d, e, f, g) => `function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

const log = [];

const impostors = [
  ["7", () => 7],
  ["'3'", () => '3'],
  ["''", () => ''],
  ["' 12 '", () => ' 12 '],
  ["'0x10'", () => '0x10'],
  ["'abc'", () => 'abc'],
  ["'1e3'", () => '1e3'],
  ["'-0'", () => '-0'],
  ["null", () => null],
  ["undefined", () => undefined],
  ["true", () => true],
  ["false", () => false],
  ["NaN", () => NaN],
  ["Infinity", () => Infinity],
  ["-Infinity", () => -Infinity],
  ["-0", () => -0],
  ["0.5", () => 0.5],
  ["-1.5", () => -1.5],
  ["2147483647", () => 2147483647],
  ["2147483648", () => 2147483648],
  ["-2147483648", () => -2147483648],
  ["-2147483649", () => -2147483649],
  ["4294967295", () => 4294967295],
  ["4294967297", () => 4294967297],
  ["9007199254740993", () => 9007199254740993],
  ["1e21", () => 1e21],
  ["10n", () => 10n],
  ["-1n", () => -1n],
  ["2n ** 64n", () => 2n ** 64n],
  ["[]", () => []],
  ["[5]", () => [5]],
  ["[1, 2]", () => [1, 2]],
  ["['0x10']", () => ['0x10']],
  ["[[7]]", () => [[7]]],
  ["[null]", () => [null]],
  ["({})", () => ({})],
  ["Object.create(null)", () => Object.create(null)],
  ["new Date(86400000)", () => new Date(86400000)],
  ["new Date(NaN)", () => new Date(NaN)],
  ["new Number(6)", () => new Number(6)],
  ["new String('8')", () => new String('8')],
  ["new Boolean(true)", () => new Boolean(true)],
  ["Object(4n)", () => Object(4n)],
  ["Symbol('s')", () => Symbol('s')],
  ["Object(Symbol('boxed'))", () => Object(Symbol('boxed'))],
  ["Object.assign(function () {}, { toString() { log.push('toString'); return 'text of a function'; } })", () => Object.assign(function () {}, { toString() { log.push('toString'); return 'text of a function'; } })],
  ["({ valueOf() { log.push('valueOf'); return 9; }, toString() { log.push('toString'); return '11'; } })", () => ({ valueOf() { log.push('valueOf'); return 9; }, toString() { log.push('toString'); return '11'; } })],
  ["({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '13'; } })", () => ({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '13'; } })],
  ["({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return {}; } })", () => ({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return {}; } })],
  ["({ valueOf() { log.push('valueOf'); throw new RangeError('no'); } })", () => ({ valueOf() { log.push('valueOf'); throw new RangeError('no'); } })],
  ["({ valueOf() { log.push('valueOf'); return 5n; } })", () => ({ valueOf() { log.push('valueOf'); return 5n; } })],
  ["({ valueOf() { log.push('valueOf'); return '21'; } })", () => ({ valueOf() { log.push('valueOf'); return '21'; } })],
  ["({ valueOf() { log.push('valueOf'); return -0; } })", () => ({ valueOf() { log.push('valueOf'); return -0; } })],
  ["({ valueOf() { log.push('valueOf'); return Symbol('inner'); } })", () => ({ valueOf() { log.push('valueOf'); return Symbol('inner'); } })],
  ["({ valueOf: 5, toString() { log.push('toString'); return '17'; } })", () => ({ valueOf: 5, toString() { log.push('toString'); return '17'; } })],
  ["({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === 'number' ? 1 : hint === 'string' ? '2' : 3; } })", () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === 'number' ? 1 : hint === 'string' ? '2' : 3; } })],
  ["({ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } })", () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } })],
  ["({ [Symbol.toPrimitive]: undefined, valueOf() { log.push('valueOf'); return 15; } })", () => ({ [Symbol.toPrimitive]: undefined, valueOf() { log.push('valueOf'); return 15; } })],
  ["({ [Symbol.toPrimitive]: 5 })", () => ({ [Symbol.toPrimitive]: 5 })],
  ["new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'valueOf' ? () => 19 : undefined; } })", () => new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'valueOf' ? () => 19 : undefined; } })],
];

function describe(use, [text, make]) {
  log.length = 0;
  const result = outcome(() => use(make()));
  return use.name + " of " + text + " -> " + result + (log.length ? " after " + log.join(", ") : "");
}

function runTable(uses, rows) {
  const first = [];
  for (const use of uses) {
    for (const row of rows) {
      first.push(describe(use, row));
      console.log(first[first.length - 1]);
    }
  }
  for (let i = 0; i < 2000; i++) for (const use of uses) use(i % 50);
  let same = 0;
  let at = 0;
  for (const use of uses) {
    const honest = outcome(() => use(7));
    for (const row of rows) {
      const again = describe(use, row);
      if (again === first[at++]) same++;
      else console.log("changed after 2000 honest calls:", again);
      const between = outcome(() => use(7));
      if (between !== honest) console.log("an honest call changed after", row[0], "->", between);
    }
  }
  console.log(same, "of", first.length, "are the same after 2000 honest calls");
}

function ${a}Assign(value) {
  value ${b};
  return value;
}

function ${c}Assign(value) {
  value ${d};
  return value;
}

function ${e}n(value) {
  value ${f};
  return value;
}

runTable([${g}n], impostors);
`,
    ),
    ...family(
      `numbers/a-number-is-compared-with-values-that-are-not-numbers.js	zeroLessThan	0 < value	zeroAtMost	0 <= value	zeroMoreThan	0 > value	zeroAtLeast	0 >= value	zeroLessThan, zeroAtMost, zeroMoreThan, zeroAtLeast
numbers/unary-plus-and-minus-of-values-that-are-not-numbers.js	plus	+value	minus	-value	minusMinus	-(-value)	plusOfMinus	+-value	plus, minus, minusMinus, plusOfMinus
numbers/values-that-are-not-numbers-are-compared-with-a-number.js	lessThanFive	value < 5	atMostFive	value <= 5	moreThanFive	value > 5	atLeastFive	value >= 5	lessThanFive, atMostFive, moreThanFive, atLeastFive
numbers/values-that-are-not-numbers-are-divided.js	halved	value / 2	inverted	1 / value	remainderByThree	value % 3	sevenModulo	7 % value	halved, inverted, remainderByThree, sevenModulo
numbers/values-that-are-not-numbers-are-raised-to-a-power.js	squared	value ** 2	twoToThe	2 ** value	toTheZeroth	value ** 0	toItself	value ** value	squared, twoToThe, toTheZeroth, toItself
numbers/values-that-are-not-numbers-are-subtracted-and-multiplied.js	minusOne	value - 1	oneMinus	1 - value	timesTwo	value * 2	twoTimes	2 * value	minusOne, oneMinus, timesTwo, twoTimes`,
      (a, b, c, d, e, f, g, h, i) => `function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

const log = [];

function make(text) {
  return new Function("log", "return (" + text + ");")(log);
}

const impostors = [
  "7",
  "'3'",
  "''",
  "' 12 '",
  "'0x10'",
  "'abc'",
  "'1e3'",
  "'-0'",
  "null",
  "undefined",
  "true",
  "false",
  "NaN",
  "Infinity",
  "-Infinity",
  "-0",
  "0.5",
  "-1.5",
  "2147483647",
  "2147483648",
  "-2147483648",
  "-2147483649",
  "4294967295",
  "4294967297",
  "9007199254740993",
  "1e21",
  "10n",
  "-1n",
  "2n ** 64n",
  "[]",
  "[5]",
  "[1, 2]",
  "['0x10']",
  "[[7]]",
  "[null]",
  "({})",
  "Object.create(null)",
  "new Date(86400000)",
  "new Date(NaN)",
  "new Number(6)",
  "new String('8')",
  "new Boolean(true)",
  "Object(4n)",
  "Symbol('s')",
  "Object(Symbol('boxed'))",
  "Object.assign(function () {}, { toString() { log.push('toString'); return 'text of a function'; } })",
  "({ valueOf() { log.push('valueOf'); return 9; }, toString() { log.push('toString'); return '11'; } })",
  "({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '13'; } })",
  "({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return {}; } })",
  "({ valueOf() { log.push('valueOf'); throw new RangeError('no'); } })",
  "({ valueOf() { log.push('valueOf'); return 5n; } })",
  "({ valueOf() { log.push('valueOf'); return '21'; } })",
  "({ valueOf() { log.push('valueOf'); return -0; } })",
  "({ valueOf() { log.push('valueOf'); return Symbol('inner'); } })",
  "({ valueOf: 5, toString() { log.push('toString'); return '17'; } })",
  "({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === 'number' ? 1 : hint === 'string' ? '2' : 3; } })",
  "({ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } })",
  "({ [Symbol.toPrimitive]: undefined, valueOf() { log.push('valueOf'); return 15; } })",
  "({ [Symbol.toPrimitive]: 5 })",
  "new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'valueOf' ? () => 19 : undefined; } })",
];

function describe(use, text) {
  log.length = 0;
  const result = outcome(() => use(make(text)));
  return use.name + " of " + text + " -> " + result + (log.length ? " after " + log.join(", ") : "");
}

function runTable(uses, texts) {
  const first = [];
  for (const use of uses) {
    for (const text of texts) {
      first.push(describe(use, text));
      console.log(first[first.length - 1]);
    }
  }
  for (let i = 0; i < 2000; i++) for (const use of uses) use(i % 50);
  let same = 0;
  let at = 0;
  for (const use of uses) {
    const honest = outcome(() => use(7));
    for (const text of texts) {
      const again = describe(use, text);
      if (again === first[at++]) same++;
      else console.log("changed after 2000 honest calls:", again);
      const between = outcome(() => use(7));
      if (between !== honest) console.log("an honest call changed after", text, "->", between);
    }
  }
  console.log(same, "of", first.length, "are the same after 2000 honest calls");
}

function ${a}(value) {
  return ${b};
}

function ${c}(value) {
  return ${d};
}

function ${e}(value) {
  return ${f};
}

function ${g}(value) {
  return ${h};
}

runTable([${i}], impostors);
`,
    ),
    "prototype-names/eighty-optional-fields-are-stored-for-the-first-time-in-a-scrambled-order.ts": text(
      `// An interface and a class with eighty optional fields of four kinds: more than fit into the cell of one object. The fields are stored for the first time by typed code, in a scrambled order that differs from object to object,
// some are deleted and stored again, and the collector runs in between. Every value must come back, absent fields must read as undefined, and the keys must be in the order of creation.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
interface Wide {
  id: number;`,
      [
        20,
        n => `  f${4 * n}?: number;
  f${4 * n + 1}?: string;
  f${4 * n + 2}?: { n: number };
  f${4 * n + 3}?: boolean;`,
      ],
      `}
class WideClass implements Wide {
  declare id: number;`,
      [
        20,
        n => `  declare f${4 * n}?: number;
  declare f${4 * n + 1}?: string;
  declare f${4 * n + 2}?: { n: number };
  declare f${4 * n + 3}?: boolean;`,
      ],
      `  constructor(id: number) {
    this.id = id;
    handOver(this);
  }
}
function storeLiteral(wide: Wide, index: number, v: number) {
  switch (index) {`,
      [
        20,
        n => `    case ${4 * n}: wide.f${4 * n} = v; break;
    case ${4 * n + 1}: wide.f${4 * n + 1} = "s" + v; break;
    case ${4 * n + 2}: wide.f${4 * n + 2} = { n: v }; break;
    case ${4 * n + 3}: wide.f${4 * n + 3} = (v & 1) === 1; break;`,
      ],
      `  }
}
function readLiteral(wide: Wide, index: number): unknown {
  switch (index) {`,
      [80, n => `    case ${n}: return wide.f${n};`],
      `  }
}
function dropLiteral(wide: Wide, index: number) {
  switch (index) {`,
      [27, n => `    case ${3 * n}: return delete wide.f${3 * n};`],
      `  }
  return false;
}
function storeInstance(wide: WideClass, index: number, v: number) {
  switch (index) {`,
      [
        20,
        n => `    case ${4 * n}: wide.f${4 * n} = v; break;
    case ${4 * n + 1}: wide.f${4 * n + 1} = "s" + v; break;
    case ${4 * n + 2}: wide.f${4 * n + 2} = { n: v }; break;
    case ${4 * n + 3}: wide.f${4 * n + 3} = (v & 1) === 1; break;`,
      ],
      `  }
}
function readInstance(wide: WideClass, index: number): unknown {
  switch (index) {`,
      [80, n => `    case ${n}: return wide.f${n};`],
      `  }
}
function dropInstance(wide: WideClass, index: number) {
  switch (index) {`,
      [27, n => `    case ${3 * n}: return delete wide.f${3 * n};`],
      `  }
  return false;
}
function expected(index: number, v: number): string {
  return JSON.stringify([v, "s" + v, { n: v }, (v & 1) === 1][index % 4]);
}
function scrambled(seed: number, count: number) {
  const order: number[] = [];
  for (let i = 0; i < 80; i++) order.push(i);
  let state = seed * 2654435761 + 1;
  for (let i = 79; i > 0; i--) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, count);
}
function exercise(label: string, make: (id: number) => Wide, store: (wide: any, index: number, v: number) => void, read: (wide: any, index: number) => unknown, drop: (wide: any, index: number) => boolean) {
  const objects: Wide[] = [];
  const orders: number[][] = [];
  for (let id = 0; id < 400; id++) {
    const wide = make(id);
    const order = scrambled(id, id % 81);
    for (const index of order) store(wide, index, id + index);
    objects.push(wide);
    orders.push(order);
  }
  Bun.gc(true);
  let junk = 0;
  for (let i = 0; i < 400000; i++) junk += [i, { n: i }, "j" + (i & 255)].length;
  let wrongValues = 0;
  let wrongAbsent = 0;
  let wrongKeys = 0;
  objects.forEach((wide, id) => {
    const present = new Set(orders[id]);
    for (let index = 0; index < 80; index++) {
      const value = read(wide, index);
      if (present.has(index)) {
        if (JSON.stringify(value) !== expected(index, id + index)) wrongValues++;
      } else if (value !== undefined || "f" + index in wide) wrongAbsent++;
    }
    if (Object.keys(wide).join() !== ["id", ...orders[id].map(index => "f" + index)].join()) wrongKeys++;
  });
  console.log(label, "| filled:", junk, wrongValues, wrongAbsent, wrongKeys);
  wrongKeys = 0;
  wrongValues = 0;
  objects.forEach((wide, id) => {
    const order = orders[id];
    const moved = order.filter(index => index % 3 === 0);
    for (const index of moved) drop(wide, index);
    const between = Object.keys(wide).join() === ["id", ...order.filter(index => index % 3 !== 0).map(index => "f" + index)].join();
    for (const index of moved) store(wide, index, id - index);
    const after = Object.keys(wide).join() === ["id", ...order.filter(index => index % 3 !== 0), ...moved].map(index => (index === "id" ? index : "f" + index)).join();
    if (!between || !after) wrongKeys++;
    for (const index of moved) if (JSON.stringify(read(wide, index)) !== expected(index, id - index)) wrongValues++;
  });
  console.log(label, "| every third deleted and stored again:", wrongValues, wrongKeys);
  const sample = objects[5];
  console.log(label, "| a sample:", JSON.stringify(sample), Object.keys(objects[80]).length, Object.keys(objects[0]).join());
}
exercise("literals", id => { const made: Wide = { id }; handOver(made); return made; }, storeLiteral, readLiteral, dropLiteral);
exercise("instances", id => new WideClass(id), storeInstance, readInstance, dropInstance);
`,
    ),
  });
