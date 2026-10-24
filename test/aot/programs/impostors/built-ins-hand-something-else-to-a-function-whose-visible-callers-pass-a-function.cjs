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

function calls1(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls2(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls3(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls4(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls5(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls6(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls7(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls8(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls9(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls10(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls11(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls12(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls13(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls14(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls15(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls16(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls17(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls18(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls19(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls20(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls21(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls22(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls23(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls24(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls25(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls26(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls27(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls28(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls29(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls30(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls31(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls32(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls33(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls34(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls35(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls36(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls37(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls38(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls39(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls40(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls41(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls42(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls43(f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls44(ignored, f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls45(ignored, f) {
  const result = f(1);
  results.push(result);
  return result;
}

function calls46(f) {
  const result = f(1);
  results.push(result);
  return result;
}

console.log("strict:", (function () { return this === undefined; })());

calls1(x => x + 1);
calls1(x => x + 1);
observe("forEach: a function", () => [(x => x + 1)].forEach(calls1));
observe("forEach: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].forEach(calls1));
observe("forEach: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].forEach(calls1));
observe("forEach: a function again", () => [(x => x + 1)].forEach(calls1));

calls2(x => x + 1);
calls2(x => x + 1);
observe("map: a function", () => [(x => x + 1)].map(calls2));
observe("map: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].map(calls2));
observe("map: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].map(calls2));
observe("map: a function again", () => [(x => x + 1)].map(calls2));

calls3(x => x + 1);
calls3(x => x + 1);
observe("filter: a function", () => [(x => x + 1)].filter(calls3));
observe("filter: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].filter(calls3));
observe("filter: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].filter(calls3));
observe("filter: a function again", () => [(x => x + 1)].filter(calls3));

calls4(x => x + 1);
calls4(x => x + 1);
observe("some: a function", () => [(x => x + 1)].some(calls4));
observe("some: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].some(calls4));
observe("some: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].some(calls4));
observe("some: a function again", () => [(x => x + 1)].some(calls4));

calls5(x => x + 1);
calls5(x => x + 1);
observe("every: a function", () => [(x => x + 1)].every(calls5));
observe("every: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].every(calls5));
observe("every: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].every(calls5));
observe("every: a function again", () => [(x => x + 1)].every(calls5));

calls6(x => x + 1);
calls6(x => x + 1);
observe("find: a function", () => [(x => x + 1)].find(calls6));
observe("find: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].find(calls6));
observe("find: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].find(calls6));
observe("find: a function again", () => [(x => x + 1)].find(calls6));

calls7(x => x + 1);
calls7(x => x + 1);
observe("findIndex: a function", () => [(x => x + 1)].findIndex(calls7));
observe("findIndex: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].findIndex(calls7));
observe("findIndex: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].findIndex(calls7));
observe("findIndex: a function again", () => [(x => x + 1)].findIndex(calls7));

calls8(x => x + 1);
calls8(x => x + 1);
observe("findLast: a function", () => [(x => x + 1)].findLast(calls8));
observe("findLast: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].findLast(calls8));
observe("findLast: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].findLast(calls8));
observe("findLast: a function again", () => [(x => x + 1)].findLast(calls8));

calls9(x => x + 1);
calls9(x => x + 1);
observe("flatMap: a function", () => [(x => x + 1)].flatMap(calls9));
observe("flatMap: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].flatMap(calls9));
observe("flatMap: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].flatMap(calls9));
observe("flatMap: a function again", () => [(x => x + 1)].flatMap(calls9));

calls10(x => x + 1);
calls10(x => x + 1);
observe("sort: a function", () => [(x => x + 1), (x => x + 1)].sort(calls10));
observe("sort: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } }), (class Made { constructor(x) { log.push("constructed " + x); } })].sort(calls10));
observe("sort: an object with call", () => [(({ call() { log.push("call"); return "called"; } })), (({ call() { log.push("call"); return "called"; } }))].sort(calls10));
observe("sort: a function again", () => [(x => x + 1), (x => x + 1)].sort(calls10));

calls11(x => x + 1);
calls11(x => x + 1);
observe("toSorted: a function", () => [(x => x + 1), (x => x + 1)].toSorted(calls11));
observe("toSorted: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } }), (class Made { constructor(x) { log.push("constructed " + x); } })].toSorted(calls11));
observe("toSorted: an object with call", () => [(({ call() { log.push("call"); return "called"; } })), (({ call() { log.push("call"); return "called"; } }))].toSorted(calls11));
observe("toSorted: a function again", () => [(x => x + 1), (x => x + 1)].toSorted(calls11));

calls12(x => x + 1);
calls12(x => x + 1);
observe("reduce with a first value: a function", () => [0].reduce(calls12, (x => x + 1)));
observe("reduce with a first value: a class", () => [0].reduce(calls12, (class Made { constructor(x) { log.push("constructed " + x); } })));
observe("reduce with a first value: an object with call", () => [0].reduce(calls12, (({ call() { log.push("call"); return "called"; } }))));
observe("reduce with a first value: a function again", () => [0].reduce(calls12, (x => x + 1)));

calls13(x => x + 1);
calls13(x => x + 1);
observe("reduce without a first value: a function", () => [(x => x + 1), 0].reduce(calls13));
observe("reduce without a first value: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } }), 0].reduce(calls13));
observe("reduce without a first value: an object with call", () => [(({ call() { log.push("call"); return "called"; } })), 0].reduce(calls13));
observe("reduce without a first value: a function again", () => [(x => x + 1), 0].reduce(calls13));

calls14(x => x + 1);
calls14(x => x + 1);
observe("reduceRight: a function", () => [0].reduceRight(calls14, (x => x + 1)));
observe("reduceRight: a class", () => [0].reduceRight(calls14, (class Made { constructor(x) { log.push("constructed " + x); } })));
observe("reduceRight: an object with call", () => [0].reduceRight(calls14, (({ call() { log.push("call"); return "called"; } }))));
observe("reduceRight: a function again", () => [0].reduceRight(calls14, (x => x + 1)));

calls15(x => x + 1);
calls15(x => x + 1);
observe("Array.from of an array: a function", () => Array.from([(x => x + 1)], calls15));
observe("Array.from of an array: a class", () => Array.from([(class Made { constructor(x) { log.push("constructed " + x); } })], calls15));
observe("Array.from of an array: an object with call", () => Array.from([(({ call() { log.push("call"); return "called"; } }))], calls15));
observe("Array.from of an array: a function again", () => Array.from([(x => x + 1)], calls15));

calls16(x => x + 1);
calls16(x => x + 1);
observe("Array.from of an array-like: a function", () => Array.from({ length: 1, 0: (x => x + 1) }, calls16));
observe("Array.from of an array-like: a class", () => Array.from({ length: 1, 0: (class Made { constructor(x) { log.push("constructed " + x); } }) }, calls16));
observe("Array.from of an array-like: an object with call", () => Array.from({ length: 1, 0: (({ call() { log.push("call"); return "called"; } })) }, calls16));
observe("Array.from of an array-like: a function again", () => Array.from({ length: 1, 0: (x => x + 1) }, calls16));

calls17(x => x + 1);
calls17(x => x + 1);
observe("Array.from of a set: a function", () => Array.from(new Set([(x => x + 1)]), calls17));
observe("Array.from of a set: a class", () => Array.from(new Set([(class Made { constructor(x) { log.push("constructed " + x); } })]), calls17));
observe("Array.from of a set: an object with call", () => Array.from(new Set([(({ call() { log.push("call"); return "called"; } }))]), calls17));
observe("Array.from of a set: a function again", () => Array.from(new Set([(x => x + 1)]), calls17));

calls18(x => x + 1);
calls18(x => x + 1);
observe("forEach of an array-like: a function", () => Array.prototype.forEach.call({ length: 1, 0: (x => x + 1) }, calls18));
observe("forEach of an array-like: a class", () => Array.prototype.forEach.call({ length: 1, 0: (class Made { constructor(x) { log.push("constructed " + x); } }) }, calls18));
observe("forEach of an array-like: an object with call", () => Array.prototype.forEach.call({ length: 1, 0: (({ call() { log.push("call"); return "called"; } })) }, calls18));
observe("forEach of an array-like: a function again", () => Array.prototype.forEach.call({ length: 1, 0: (x => x + 1) }, calls18));

calls19(x => x + 1);
calls19(x => x + 1);
observe("forEach of a set: a function", () => new Set([(x => x + 1)]).forEach(calls19));
observe("forEach of a set: a class", () => new Set([(class Made { constructor(x) { log.push("constructed " + x); } })]).forEach(calls19));
observe("forEach of a set: an object with call", () => new Set([(({ call() { log.push("call"); return "called"; } }))]).forEach(calls19));
observe("forEach of a set: a function again", () => new Set([(x => x + 1)]).forEach(calls19));

calls20(x => x + 1);
calls20(x => x + 1);
observe("forEach of a map: a function", () => new Map([[0, (x => x + 1)]]).forEach(calls20));
observe("forEach of a map: a class", () => new Map([[0, (class Made { constructor(x) { log.push("constructed " + x); } })]]).forEach(calls20));
observe("forEach of a map: an object with call", () => new Map([[0, (({ call() { log.push("call"); return "called"; } }))]]).forEach(calls20));
observe("forEach of a map: a function again", () => new Map([[0, (x => x + 1)]]).forEach(calls20));

calls21(x => x + 1);
calls21(x => x + 1);
observe("map of an iterator: a function", () => [(x => x + 1)].values().map(calls21).toArray());
observe("map of an iterator: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].values().map(calls21).toArray());
observe("map of an iterator: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].values().map(calls21).toArray());
observe("map of an iterator: a function again", () => [(x => x + 1)].values().map(calls21).toArray());

calls22(x => x + 1);
calls22(x => x + 1);
observe("forEach of an iterator: a function", () => [(x => x + 1)].values().forEach(calls22));
observe("forEach of an iterator: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].values().forEach(calls22));
observe("forEach of an iterator: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].values().forEach(calls22));
observe("forEach of an iterator: a function again", () => [(x => x + 1)].values().forEach(calls22));

calls23(x => x + 1);
calls23(x => x + 1);
observe("reduce of an iterator: a function", () => [0].values().reduce(calls23, (x => x + 1)));
observe("reduce of an iterator: a class", () => [0].values().reduce(calls23, (class Made { constructor(x) { log.push("constructed " + x); } })));
observe("reduce of an iterator: an object with call", () => [0].values().reduce(calls23, (({ call() { log.push("call"); return "called"; } }))));
observe("reduce of an iterator: a function again", () => [0].values().reduce(calls23, (x => x + 1)));

calls24(x => x + 1);
calls24(x => x + 1);
observe("filter of an iterator: a function", () => [(x => x + 1)].values().filter(calls24).toArray());
observe("filter of an iterator: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].values().filter(calls24).toArray());
observe("filter of an iterator: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].values().filter(calls24).toArray());
observe("filter of an iterator: a function again", () => [(x => x + 1)].values().filter(calls24).toArray());

calls25(x => x + 1);
calls25(x => x + 1);
observe("find of an iterator: a function", () => [(x => x + 1)].values().find(calls25));
observe("find of an iterator: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].values().find(calls25));
observe("find of an iterator: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].values().find(calls25));
observe("find of an iterator: a function again", () => [(x => x + 1)].values().find(calls25));

calls26(x => x + 1);
calls26(x => x + 1);
observe("some of an iterator: a function", () => [(x => x + 1)].values().some(calls26));
observe("some of an iterator: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].values().some(calls26));
observe("some of an iterator: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].values().some(calls26));
observe("some of an iterator: a function again", () => [(x => x + 1)].values().some(calls26));

calls27(x => x + 1);
calls27(x => x + 1);
observe("every of an iterator: a function", () => [(x => x + 1)].values().every(calls27));
observe("every of an iterator: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].values().every(calls27));
observe("every of an iterator: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].values().every(calls27));
observe("every of an iterator: a function again", () => [(x => x + 1)].values().every(calls27));

calls28(x => x + 1);
calls28(x => x + 1);
observe("findLastIndex: a function", () => [(x => x + 1)].findLastIndex(calls28));
observe("findLastIndex: a class", () => [(class Made { constructor(x) { log.push("constructed " + x); } })].findLastIndex(calls28));
observe("findLastIndex: an object with call", () => [(({ call() { log.push("call"); return "called"; } }))].findLastIndex(calls28));
observe("findLastIndex: a function again", () => [(x => x + 1)].findLastIndex(calls28));

calls29(x => x + 1);
calls29(x => x + 1);
observe("a typed array made from a list: a function", () => Uint8Array.from([(x => x + 1)], calls29));
observe("a typed array made from a list: a class", () => Uint8Array.from([(class Made { constructor(x) { log.push("constructed " + x); } })], calls29));
observe("a typed array made from a list: an object with call", () => Uint8Array.from([(({ call() { log.push("call"); return "called"; } }))], calls29));
observe("a typed array made from a list: a function again", () => Uint8Array.from([(x => x + 1)], calls29));

calls30(x => x + 1);
calls30(x => x + 1);
observe("adopt of a disposable stack: a function", () => (stack => (stack.adopt((x => x + 1), calls30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: a class", () => (stack => (stack.adopt((class Made { constructor(x) { log.push("constructed " + x); } }), calls30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an object with call", () => (stack => (stack.adopt((({ call() { log.push("call"); return "called"; } })), calls30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: a function again", () => (stack => (stack.adopt((x => x + 1), calls30), stack.dispose()))(new DisposableStack()));

calls31(x => x + 1);
calls31(x => x + 1);
observe("getOrInsertComputed of a map: a function", () => new Map().getOrInsertComputed((x => x + 1), calls31));
observe("getOrInsertComputed of a map: a class", () => new Map().getOrInsertComputed((class Made { constructor(x) { log.push("constructed " + x); } }), calls31));
observe("getOrInsertComputed of a map: an object with call", () => new Map().getOrInsertComputed((({ call() { log.push("call"); return "called"; } })), calls31));
observe("getOrInsertComputed of a map: a function again", () => new Map().getOrInsertComputed((x => x + 1), calls31));

calls32(x => x + 1);
calls32(x => x + 1);
observe("Object.groupBy: a function", () => Object.groupBy([(x => x + 1)], calls32));
observe("Object.groupBy: a class", () => Object.groupBy([(class Made { constructor(x) { log.push("constructed " + x); } })], calls32));
observe("Object.groupBy: an object with call", () => Object.groupBy([(({ call() { log.push("call"); return "called"; } }))], calls32));
observe("Object.groupBy: a function again", () => Object.groupBy([(x => x + 1)], calls32));

calls33(x => x + 1);
calls33(x => x + 1);
observe("Map.groupBy: a function", () => Map.groupBy([(x => x + 1)], calls33));
observe("Map.groupBy: a class", () => Map.groupBy([(class Made { constructor(x) { log.push("constructed " + x); } })], calls33));
observe("Map.groupBy: an object with call", () => Map.groupBy([(({ call() { log.push("call"); return "called"; } }))], calls33));
observe("Map.groupBy: a function again", () => Map.groupBy([(x => x + 1)], calls33));

calls34(x => x + 1);
calls34(x => x + 1);
observe("Reflect.apply: a function", () => Reflect.apply(calls34, undefined, [(x => x + 1)]));
observe("Reflect.apply: a class", () => Reflect.apply(calls34, undefined, [(class Made { constructor(x) { log.push("constructed " + x); } })]));
observe("Reflect.apply: an object with call", () => Reflect.apply(calls34, undefined, [(({ call() { log.push("call"); return "called"; } }))]));
observe("Reflect.apply: a function again", () => Reflect.apply(calls34, undefined, [(x => x + 1)]));

calls35(x => x + 1);
calls35(x => x + 1);
observe("Reflect.apply with an array-like: a function", () => Reflect.apply(calls35, undefined, { length: 1, 0: (x => x + 1) }));
observe("Reflect.apply with an array-like: a class", () => Reflect.apply(calls35, undefined, { length: 1, 0: (class Made { constructor(x) { log.push("constructed " + x); } }) }));
observe("Reflect.apply with an array-like: an object with call", () => Reflect.apply(calls35, undefined, { length: 1, 0: (({ call() { log.push("call"); return "called"; } })) }));
observe("Reflect.apply with an array-like: a function again", () => Reflect.apply(calls35, undefined, { length: 1, 0: (x => x + 1) }));

calls36(x => x + 1);
calls36(x => x + 1);
observe("Reflect.construct: a function", () => Reflect.construct(calls36, [(x => x + 1)]));
observe("Reflect.construct: a class", () => Reflect.construct(calls36, [(class Made { constructor(x) { log.push("constructed " + x); } })]));
observe("Reflect.construct: an object with call", () => Reflect.construct(calls36, [(({ call() { log.push("call"); return "called"; } }))]));
observe("Reflect.construct: a function again", () => Reflect.construct(calls36, [(x => x + 1)]));

calls37(x => x + 1);
calls37(x => x + 1);
observe("call: a function", () => calls37.call(undefined, (x => x + 1)));
observe("call: a class", () => calls37.call(undefined, (class Made { constructor(x) { log.push("constructed " + x); } })));
observe("call: an object with call", () => calls37.call(undefined, (({ call() { log.push("call"); return "called"; } }))));
observe("call: a function again", () => calls37.call(undefined, (x => x + 1)));

calls38(x => x + 1);
calls38(x => x + 1);
observe("apply: a function", () => calls38.apply(undefined, [(x => x + 1)]));
observe("apply: a class", () => calls38.apply(undefined, [(class Made { constructor(x) { log.push("constructed " + x); } })]));
observe("apply: an object with call", () => calls38.apply(undefined, [(({ call() { log.push("call"); return "called"; } }))]));
observe("apply: a function again", () => calls38.apply(undefined, [(x => x + 1)]));

calls39(x => x + 1);
calls39(x => x + 1);
observe("bind: a function", () => calls39.bind(undefined, (x => x + 1))());
observe("bind: a class", () => calls39.bind(undefined, (class Made { constructor(x) { log.push("constructed " + x); } }))());
observe("bind: an object with call", () => calls39.bind(undefined, (({ call() { log.push("call"); return "called"; } })))());
observe("bind: a function again", () => calls39.bind(undefined, (x => x + 1))());

calls40(x => x + 1);
calls40(x => x + 1);
observe("a setter: a function", () => Object.defineProperty({}, "key", { set: calls40 }).key = (x => x + 1));
observe("a setter: a class", () => Object.defineProperty({}, "key", { set: calls40 }).key = (class Made { constructor(x) { log.push("constructed " + x); } }));
observe("a setter: an object with call", () => Object.defineProperty({}, "key", { set: calls40 }).key = (({ call() { log.push("call"); return "called"; } })));
observe("a setter: a function again", () => Object.defineProperty({}, "key", { set: calls40 }).key = (x => x + 1));

calls41(x => x + 1);
calls41(x => x + 1);
observe("Symbol.hasInstance: a function", () => (x => x + 1) instanceof { [Symbol.hasInstance]: calls41 });
observe("Symbol.hasInstance: a class", () => (class Made { constructor(x) { log.push("constructed " + x); } }) instanceof { [Symbol.hasInstance]: calls41 });
observe("Symbol.hasInstance: an object with call", () => (({ call() { log.push("call"); return "called"; } })) instanceof { [Symbol.hasInstance]: calls41 });
observe("Symbol.hasInstance: a function again", () => (x => x + 1) instanceof { [Symbol.hasInstance]: calls41 });

calls42(x => x + 1);
calls42(x => x + 1);
observe("the set trap of a proxy: a function", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(calls42, undefined, [value]), true) }).key = (x => x + 1));
observe("the set trap of a proxy: a class", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(calls42, undefined, [value]), true) }).key = (class Made { constructor(x) { log.push("constructed " + x); } }));
observe("the set trap of a proxy: an object with call", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(calls42, undefined, [value]), true) }).key = (({ call() { log.push("call"); return "called"; } })));
observe("the set trap of a proxy: a function again", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(calls42, undefined, [value]), true) }).key = (x => x + 1));

calls43(x => x + 1);
calls43(x => x + 1);
observe("a replacer of JSON.stringify: a function", () => JSON.stringify(0, () => void [(x => x + 1)].forEach(calls43)));
observe("a replacer of JSON.stringify: a class", () => JSON.stringify(0, () => void [(class Made { constructor(x) { log.push("constructed " + x); } })].forEach(calls43)));
observe("a replacer of JSON.stringify: an object with call", () => JSON.stringify(0, () => void [(({ call() { log.push("call"); return "called"; } }))].forEach(calls43)));
observe("a replacer of JSON.stringify: a function again", () => JSON.stringify(0, () => void [(x => x + 1)].forEach(calls43)));

calls44(0, x => x + 1);
calls44(0, x => x + 1);
observe("a tagged template: a function", () => calls44.bind(undefined)`${(x => x + 1)}`);
observe("a tagged template: a class", () => calls44.bind(undefined)`${(class Made { constructor(x) { log.push("constructed " + x); } })}`);
observe("a tagged template: an object with call", () => calls44.bind(undefined)`${(({ call() { log.push("call"); return "called"; } }))}`);
observe("a tagged template: a function again", () => calls44.bind(undefined)`${(x => x + 1)}`);

calls45(0, x => x + 1);
calls45(0, x => x + 1);
observe("a replacer of JSON.stringify, second parameter: a function", () => JSON.stringify((x => x + 1), calls45));
observe("a replacer of JSON.stringify, second parameter: a class", () => JSON.stringify((class Made { constructor(x) { log.push("constructed " + x); } }), calls45));
observe("a replacer of JSON.stringify, second parameter: an object with call", () => JSON.stringify((({ call() { log.push("call"); return "called"; } })), calls45));
observe("a replacer of JSON.stringify, second parameter: a function again", () => JSON.stringify((x => x + 1), calls45));

calls46(x => x + 1);
calls46(x => x + 1);
observe("a listener of an event emitter: a function", () => new (require("node:events").EventEmitter)().once("value", calls46).emit("value", (x => x + 1)));
observe("a listener of an event emitter: a class", () => new (require("node:events").EventEmitter)().once("value", calls46).emit("value", (class Made { constructor(x) { log.push("constructed " + x); } })));
observe("a listener of an event emitter: an object with call", () => new (require("node:events").EventEmitter)().once("value", calls46).emit("value", (({ call() { log.push("call"); return "called"; } }))));
observe("a listener of an event emitter: a function again", () => new (require("node:events").EventEmitter)().once("value", calls46).emit("value", (x => x + 1)));
