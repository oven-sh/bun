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

function pushes1(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes2(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes3(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes4(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes5(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes6(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes7(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes8(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes9(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes10(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes11(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes12(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes13(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes14(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes15(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes16(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes17(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes18(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes19(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes20(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes21(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes22(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes23(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes24(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes25(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes26(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes27(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes28(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes29(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes30(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes31(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes32(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes33(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes34(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes35(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes36(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes37(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes38(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes39(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes40(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes41(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes42(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes43(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes44(ignored, a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes45(ignored, a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes46(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

console.log("strict:", (function () { return this === undefined; })());

pushes1([5, 6]);
pushes1([5, 6]);
observe("forEach: an array", () => [([5, 6])].forEach(pushes1));
observe("forEach: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].forEach(pushes1));
observe("forEach: a subclass", () => [(Odd.of(5, 6))].forEach(pushes1));
observe("forEach: an array again", () => [([5, 6])].forEach(pushes1));

pushes2([5, 6]);
pushes2([5, 6]);
observe("map: an array", () => [([5, 6])].map(pushes2));
observe("map: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].map(pushes2));
observe("map: a subclass", () => [(Odd.of(5, 6))].map(pushes2));
observe("map: an array again", () => [([5, 6])].map(pushes2));

pushes3([5, 6]);
pushes3([5, 6]);
observe("filter: an array", () => [([5, 6])].filter(pushes3));
observe("filter: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].filter(pushes3));
observe("filter: a subclass", () => [(Odd.of(5, 6))].filter(pushes3));
observe("filter: an array again", () => [([5, 6])].filter(pushes3));

pushes4([5, 6]);
pushes4([5, 6]);
observe("some: an array", () => [([5, 6])].some(pushes4));
observe("some: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].some(pushes4));
observe("some: a subclass", () => [(Odd.of(5, 6))].some(pushes4));
observe("some: an array again", () => [([5, 6])].some(pushes4));

pushes5([5, 6]);
pushes5([5, 6]);
observe("every: an array", () => [([5, 6])].every(pushes5));
observe("every: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].every(pushes5));
observe("every: a subclass", () => [(Odd.of(5, 6))].every(pushes5));
observe("every: an array again", () => [([5, 6])].every(pushes5));

pushes6([5, 6]);
pushes6([5, 6]);
observe("find: an array", () => [([5, 6])].find(pushes6));
observe("find: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].find(pushes6));
observe("find: a subclass", () => [(Odd.of(5, 6))].find(pushes6));
observe("find: an array again", () => [([5, 6])].find(pushes6));

pushes7([5, 6]);
pushes7([5, 6]);
observe("findIndex: an array", () => [([5, 6])].findIndex(pushes7));
observe("findIndex: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].findIndex(pushes7));
observe("findIndex: a subclass", () => [(Odd.of(5, 6))].findIndex(pushes7));
observe("findIndex: an array again", () => [([5, 6])].findIndex(pushes7));

pushes8([5, 6]);
pushes8([5, 6]);
observe("findLast: an array", () => [([5, 6])].findLast(pushes8));
observe("findLast: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].findLast(pushes8));
observe("findLast: a subclass", () => [(Odd.of(5, 6))].findLast(pushes8));
observe("findLast: an array again", () => [([5, 6])].findLast(pushes8));

pushes9([5, 6]);
pushes9([5, 6]);
observe("flatMap: an array", () => [([5, 6])].flatMap(pushes9));
observe("flatMap: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].flatMap(pushes9));
observe("flatMap: a subclass", () => [(Odd.of(5, 6))].flatMap(pushes9));
observe("flatMap: an array again", () => [([5, 6])].flatMap(pushes9));

pushes10([5, 6]);
pushes10([5, 6]);
observe("sort: an array", () => [([5, 6]), ([5, 6])].sort(pushes10));
observe("sort: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })), (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].sort(pushes10));
observe("sort: a subclass", () => [(Odd.of(5, 6)), (Odd.of(5, 6))].sort(pushes10));
observe("sort: an array again", () => [([5, 6]), ([5, 6])].sort(pushes10));

pushes11([5, 6]);
pushes11([5, 6]);
observe("toSorted: an array", () => [([5, 6]), ([5, 6])].toSorted(pushes11));
observe("toSorted: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })), (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].toSorted(pushes11));
observe("toSorted: a subclass", () => [(Odd.of(5, 6)), (Odd.of(5, 6))].toSorted(pushes11));
observe("toSorted: an array again", () => [([5, 6]), ([5, 6])].toSorted(pushes11));

pushes12([5, 6]);
pushes12([5, 6]);
observe("reduce with a first value: an array", () => [0].reduce(pushes12, ([5, 6])));
observe("reduce with a first value: an array-like", () => [0].reduce(pushes12, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
observe("reduce with a first value: a subclass", () => [0].reduce(pushes12, (Odd.of(5, 6))));
observe("reduce with a first value: an array again", () => [0].reduce(pushes12, ([5, 6])));

pushes13([5, 6]);
pushes13([5, 6]);
observe("reduce without a first value: an array", () => [([5, 6]), 0].reduce(pushes13));
observe("reduce without a first value: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })), 0].reduce(pushes13));
observe("reduce without a first value: a subclass", () => [(Odd.of(5, 6)), 0].reduce(pushes13));
observe("reduce without a first value: an array again", () => [([5, 6]), 0].reduce(pushes13));

pushes14([5, 6]);
pushes14([5, 6]);
observe("reduceRight: an array", () => [0].reduceRight(pushes14, ([5, 6])));
observe("reduceRight: an array-like", () => [0].reduceRight(pushes14, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
observe("reduceRight: a subclass", () => [0].reduceRight(pushes14, (Odd.of(5, 6))));
observe("reduceRight: an array again", () => [0].reduceRight(pushes14, ([5, 6])));

pushes15([5, 6]);
pushes15([5, 6]);
observe("Array.from of an array: an array", () => Array.from([([5, 6])], pushes15));
observe("Array.from of an array: an array-like", () => Array.from([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))], pushes15));
observe("Array.from of an array: a subclass", () => Array.from([(Odd.of(5, 6))], pushes15));
observe("Array.from of an array: an array again", () => Array.from([([5, 6])], pushes15));

pushes16([5, 6]);
pushes16([5, 6]);
observe("Array.from of an array-like: an array", () => Array.from({ length: 1, 0: ([5, 6]) }, pushes16));
observe("Array.from of an array-like: an array-like", () => Array.from({ length: 1, 0: (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })) }, pushes16));
observe("Array.from of an array-like: a subclass", () => Array.from({ length: 1, 0: (Odd.of(5, 6)) }, pushes16));
observe("Array.from of an array-like: an array again", () => Array.from({ length: 1, 0: ([5, 6]) }, pushes16));

pushes17([5, 6]);
pushes17([5, 6]);
observe("Array.from of a set: an array", () => Array.from(new Set([([5, 6])]), pushes17));
observe("Array.from of a set: an array-like", () => Array.from(new Set([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]), pushes17));
observe("Array.from of a set: a subclass", () => Array.from(new Set([(Odd.of(5, 6))]), pushes17));
observe("Array.from of a set: an array again", () => Array.from(new Set([([5, 6])]), pushes17));

pushes18([5, 6]);
pushes18([5, 6]);
observe("forEach of an array-like: an array", () => Array.prototype.forEach.call({ length: 1, 0: ([5, 6]) }, pushes18));
observe("forEach of an array-like: an array-like", () => Array.prototype.forEach.call({ length: 1, 0: (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })) }, pushes18));
observe("forEach of an array-like: a subclass", () => Array.prototype.forEach.call({ length: 1, 0: (Odd.of(5, 6)) }, pushes18));
observe("forEach of an array-like: an array again", () => Array.prototype.forEach.call({ length: 1, 0: ([5, 6]) }, pushes18));

pushes19([5, 6]);
pushes19([5, 6]);
observe("forEach of a set: an array", () => new Set([([5, 6])]).forEach(pushes19));
observe("forEach of a set: an array-like", () => new Set([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]).forEach(pushes19));
observe("forEach of a set: a subclass", () => new Set([(Odd.of(5, 6))]).forEach(pushes19));
observe("forEach of a set: an array again", () => new Set([([5, 6])]).forEach(pushes19));

pushes20([5, 6]);
pushes20([5, 6]);
observe("forEach of a map: an array", () => new Map([[0, ([5, 6])]]).forEach(pushes20));
observe("forEach of a map: an array-like", () => new Map([[0, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]]).forEach(pushes20));
observe("forEach of a map: a subclass", () => new Map([[0, (Odd.of(5, 6))]]).forEach(pushes20));
observe("forEach of a map: an array again", () => new Map([[0, ([5, 6])]]).forEach(pushes20));

pushes21([5, 6]);
pushes21([5, 6]);
observe("map of an iterator: an array", () => [([5, 6])].values().map(pushes21).toArray());
observe("map of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().map(pushes21).toArray());
observe("map of an iterator: a subclass", () => [(Odd.of(5, 6))].values().map(pushes21).toArray());
observe("map of an iterator: an array again", () => [([5, 6])].values().map(pushes21).toArray());

pushes22([5, 6]);
pushes22([5, 6]);
observe("forEach of an iterator: an array", () => [([5, 6])].values().forEach(pushes22));
observe("forEach of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().forEach(pushes22));
observe("forEach of an iterator: a subclass", () => [(Odd.of(5, 6))].values().forEach(pushes22));
observe("forEach of an iterator: an array again", () => [([5, 6])].values().forEach(pushes22));

pushes23([5, 6]);
pushes23([5, 6]);
observe("reduce of an iterator: an array", () => [0].values().reduce(pushes23, ([5, 6])));
observe("reduce of an iterator: an array-like", () => [0].values().reduce(pushes23, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
observe("reduce of an iterator: a subclass", () => [0].values().reduce(pushes23, (Odd.of(5, 6))));
observe("reduce of an iterator: an array again", () => [0].values().reduce(pushes23, ([5, 6])));

pushes24([5, 6]);
pushes24([5, 6]);
observe("filter of an iterator: an array", () => [([5, 6])].values().filter(pushes24).toArray());
observe("filter of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().filter(pushes24).toArray());
observe("filter of an iterator: a subclass", () => [(Odd.of(5, 6))].values().filter(pushes24).toArray());
observe("filter of an iterator: an array again", () => [([5, 6])].values().filter(pushes24).toArray());

pushes25([5, 6]);
pushes25([5, 6]);
observe("find of an iterator: an array", () => [([5, 6])].values().find(pushes25));
observe("find of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().find(pushes25));
observe("find of an iterator: a subclass", () => [(Odd.of(5, 6))].values().find(pushes25));
observe("find of an iterator: an array again", () => [([5, 6])].values().find(pushes25));

pushes26([5, 6]);
pushes26([5, 6]);
observe("some of an iterator: an array", () => [([5, 6])].values().some(pushes26));
observe("some of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().some(pushes26));
observe("some of an iterator: a subclass", () => [(Odd.of(5, 6))].values().some(pushes26));
observe("some of an iterator: an array again", () => [([5, 6])].values().some(pushes26));

pushes27([5, 6]);
pushes27([5, 6]);
observe("every of an iterator: an array", () => [([5, 6])].values().every(pushes27));
observe("every of an iterator: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].values().every(pushes27));
observe("every of an iterator: a subclass", () => [(Odd.of(5, 6))].values().every(pushes27));
observe("every of an iterator: an array again", () => [([5, 6])].values().every(pushes27));

pushes28([5, 6]);
pushes28([5, 6]);
observe("findLastIndex: an array", () => [([5, 6])].findLastIndex(pushes28));
observe("findLastIndex: an array-like", () => [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].findLastIndex(pushes28));
observe("findLastIndex: a subclass", () => [(Odd.of(5, 6))].findLastIndex(pushes28));
observe("findLastIndex: an array again", () => [([5, 6])].findLastIndex(pushes28));

pushes29([5, 6]);
pushes29([5, 6]);
observe("a typed array made from a list: an array", () => Uint8Array.from([([5, 6])], pushes29));
observe("a typed array made from a list: an array-like", () => Uint8Array.from([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))], pushes29));
observe("a typed array made from a list: a subclass", () => Uint8Array.from([(Odd.of(5, 6))], pushes29));
observe("a typed array made from a list: an array again", () => Uint8Array.from([([5, 6])], pushes29));

pushes30([5, 6]);
pushes30([5, 6]);
observe("adopt of a disposable stack: an array", () => (stack => (stack.adopt(([5, 6]), pushes30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an array-like", () => (stack => (stack.adopt((({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })), pushes30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: a subclass", () => (stack => (stack.adopt((Odd.of(5, 6)), pushes30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an array again", () => (stack => (stack.adopt(([5, 6]), pushes30), stack.dispose()))(new DisposableStack()));

pushes31([5, 6]);
pushes31([5, 6]);
observe("getOrInsertComputed of a map: an array", () => new Map().getOrInsertComputed(([5, 6]), pushes31));
observe("getOrInsertComputed of a map: an array-like", () => new Map().getOrInsertComputed((({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })), pushes31));
observe("getOrInsertComputed of a map: a subclass", () => new Map().getOrInsertComputed((Odd.of(5, 6)), pushes31));
observe("getOrInsertComputed of a map: an array again", () => new Map().getOrInsertComputed(([5, 6]), pushes31));

pushes32([5, 6]);
pushes32([5, 6]);
observe("Object.groupBy: an array", () => Object.groupBy([([5, 6])], pushes32));
observe("Object.groupBy: an array-like", () => Object.groupBy([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))], pushes32));
observe("Object.groupBy: a subclass", () => Object.groupBy([(Odd.of(5, 6))], pushes32));
observe("Object.groupBy: an array again", () => Object.groupBy([([5, 6])], pushes32));

pushes33([5, 6]);
pushes33([5, 6]);
observe("Map.groupBy: an array", () => Map.groupBy([([5, 6])], pushes33));
observe("Map.groupBy: an array-like", () => Map.groupBy([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))], pushes33));
observe("Map.groupBy: a subclass", () => Map.groupBy([(Odd.of(5, 6))], pushes33));
observe("Map.groupBy: an array again", () => Map.groupBy([([5, 6])], pushes33));

pushes34([5, 6]);
pushes34([5, 6]);
observe("Reflect.apply: an array", () => Reflect.apply(pushes34, undefined, [([5, 6])]));
observe("Reflect.apply: an array-like", () => Reflect.apply(pushes34, undefined, [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]));
observe("Reflect.apply: a subclass", () => Reflect.apply(pushes34, undefined, [(Odd.of(5, 6))]));
observe("Reflect.apply: an array again", () => Reflect.apply(pushes34, undefined, [([5, 6])]));

pushes35([5, 6]);
pushes35([5, 6]);
observe("Reflect.apply with an array-like: an array", () => Reflect.apply(pushes35, undefined, { length: 1, 0: ([5, 6]) }));
observe("Reflect.apply with an array-like: an array-like", () => Reflect.apply(pushes35, undefined, { length: 1, 0: (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })) }));
observe("Reflect.apply with an array-like: a subclass", () => Reflect.apply(pushes35, undefined, { length: 1, 0: (Odd.of(5, 6)) }));
observe("Reflect.apply with an array-like: an array again", () => Reflect.apply(pushes35, undefined, { length: 1, 0: ([5, 6]) }));

pushes36([5, 6]);
pushes36([5, 6]);
observe("Reflect.construct: an array", () => Reflect.construct(pushes36, [([5, 6])]));
observe("Reflect.construct: an array-like", () => Reflect.construct(pushes36, [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]));
observe("Reflect.construct: a subclass", () => Reflect.construct(pushes36, [(Odd.of(5, 6))]));
observe("Reflect.construct: an array again", () => Reflect.construct(pushes36, [([5, 6])]));

pushes37([5, 6]);
pushes37([5, 6]);
observe("call: an array", () => pushes37.call(undefined, ([5, 6])));
observe("call: an array-like", () => pushes37.call(undefined, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
observe("call: a subclass", () => pushes37.call(undefined, (Odd.of(5, 6))));
observe("call: an array again", () => pushes37.call(undefined, ([5, 6])));

pushes38([5, 6]);
pushes38([5, 6]);
observe("apply: an array", () => pushes38.apply(undefined, [([5, 6])]));
observe("apply: an array-like", () => pushes38.apply(undefined, [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))]));
observe("apply: a subclass", () => pushes38.apply(undefined, [(Odd.of(5, 6))]));
observe("apply: an array again", () => pushes38.apply(undefined, [([5, 6])]));

pushes39([5, 6]);
pushes39([5, 6]);
observe("bind: an array", () => pushes39.bind(undefined, ([5, 6]))());
observe("bind: an array-like", () => pushes39.bind(undefined, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })))());
observe("bind: a subclass", () => pushes39.bind(undefined, (Odd.of(5, 6)))());
observe("bind: an array again", () => pushes39.bind(undefined, ([5, 6]))());

pushes40([5, 6]);
pushes40([5, 6]);
observe("a setter: an array", () => Object.defineProperty({}, "key", { set: pushes40 }).key = ([5, 6]));
observe("a setter: an array-like", () => Object.defineProperty({}, "key", { set: pushes40 }).key = (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })));
observe("a setter: a subclass", () => Object.defineProperty({}, "key", { set: pushes40 }).key = (Odd.of(5, 6)));
observe("a setter: an array again", () => Object.defineProperty({}, "key", { set: pushes40 }).key = ([5, 6]));

pushes41([5, 6]);
pushes41([5, 6]);
observe("Symbol.hasInstance: an array", () => ([5, 6]) instanceof { [Symbol.hasInstance]: pushes41 });
observe("Symbol.hasInstance: an array-like", () => (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })) instanceof { [Symbol.hasInstance]: pushes41 });
observe("Symbol.hasInstance: a subclass", () => (Odd.of(5, 6)) instanceof { [Symbol.hasInstance]: pushes41 });
observe("Symbol.hasInstance: an array again", () => ([5, 6]) instanceof { [Symbol.hasInstance]: pushes41 });

pushes42([5, 6]);
pushes42([5, 6]);
observe("the set trap of a proxy: an array", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(pushes42, undefined, [value]), true) }).key = ([5, 6]));
observe("the set trap of a proxy: an array-like", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(pushes42, undefined, [value]), true) }).key = (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })));
observe("the set trap of a proxy: a subclass", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(pushes42, undefined, [value]), true) }).key = (Odd.of(5, 6)));
observe("the set trap of a proxy: an array again", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(pushes42, undefined, [value]), true) }).key = ([5, 6]));

pushes43([5, 6]);
pushes43([5, 6]);
observe("a replacer of JSON.stringify: an array", () => JSON.stringify(0, () => void [([5, 6])].forEach(pushes43)));
observe("a replacer of JSON.stringify: an array-like", () => JSON.stringify(0, () => void [(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))].forEach(pushes43)));
observe("a replacer of JSON.stringify: a subclass", () => JSON.stringify(0, () => void [(Odd.of(5, 6))].forEach(pushes43)));
observe("a replacer of JSON.stringify: an array again", () => JSON.stringify(0, () => void [([5, 6])].forEach(pushes43)));

pushes44(0, [5, 6]);
pushes44(0, [5, 6]);
observe("a tagged template: an array", () => pushes44.bind(undefined)`${([5, 6])}`);
observe("a tagged template: an array-like", () => pushes44.bind(undefined)`${(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))}`);
observe("a tagged template: a subclass", () => pushes44.bind(undefined)`${(Odd.of(5, 6))}`);
observe("a tagged template: an array again", () => pushes44.bind(undefined)`${([5, 6])}`);

pushes45(0, [5, 6]);
pushes45(0, [5, 6]);
observe("a replacer of JSON.stringify, second parameter: an array", () => JSON.stringify(([5, 6]), pushes45));
observe("a replacer of JSON.stringify, second parameter: an array-like", () => JSON.stringify((({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })), pushes45));
observe("a replacer of JSON.stringify, second parameter: a subclass", () => JSON.stringify((Odd.of(5, 6)), pushes45));
observe("a replacer of JSON.stringify, second parameter: an array again", () => JSON.stringify(([5, 6]), pushes45));

pushes46([5, 6]);
pushes46([5, 6]);
observe("a listener of an event emitter: an array", () => new (require("node:events").EventEmitter)().once("value", pushes46).emit("value", ([5, 6])));
observe("a listener of an event emitter: an array-like", () => new (require("node:events").EventEmitter)().once("value", pushes46).emit("value", (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
observe("a listener of an event emitter: a subclass", () => new (require("node:events").EventEmitter)().once("value", pushes46).emit("value", (Odd.of(5, 6))));
observe("a listener of an event emitter: an array again", () => new (require("node:events").EventEmitter)().once("value", pushes46).emit("value", ([5, 6])));
