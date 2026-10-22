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
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
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
  console.log(label + " -> " + show(results) + " " + end);
}

function iterates1(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates2(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates3(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates4(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates5(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates6(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates7(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates8(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates9(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates10(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates11(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates12(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates13(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates14(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates15(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates16(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates17(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates18(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates19(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates20(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates21(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates22(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates23(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates24(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates25(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates26(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates27(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates28(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates29(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates30(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates31(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates32(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates33(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates34(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates35(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates36(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates37(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates38(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates39(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates40(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates41(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates42(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates43(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates44(ignored, a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

function iterates45(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  const result = seen;
  results.push(result);
  return result;
}

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
observe("a tagged template: an array", () => iterates44.bind(undefined)`${([5, 6])}`);
observe("a tagged template: an array-like", () => iterates44.bind(undefined)`${(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))}`);
observe("a tagged template: a subclass", () => iterates44.bind(undefined)`${(Odd.of(5, 6))}`);
observe("a tagged template: an array again", () => iterates44.bind(undefined)`${([5, 6])}`);

iterates45([5, 6]);
iterates45([5, 6]);
observe("a listener of an event emitter: an array", () => new (require("node:events").EventEmitter)().once("value", iterates45).emit("value", ([5, 6])));
observe("a listener of an event emitter: an array-like", () => new (require("node:events").EventEmitter)().once("value", iterates45).emit("value", (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
observe("a listener of an event emitter: a subclass", () => new (require("node:events").EventEmitter)().once("value", iterates45).emit("value", (Odd.of(5, 6))));
observe("a listener of an event emitter: an array again", () => new (require("node:events").EventEmitter)().once("value", iterates45).emit("value", ([5, 6])));
