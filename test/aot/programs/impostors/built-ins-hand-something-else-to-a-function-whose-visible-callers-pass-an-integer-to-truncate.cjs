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

function truncates1(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates2(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates3(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates4(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates5(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates6(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates7(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates8(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates9(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates10(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates11(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates12(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates13(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates14(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates15(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates16(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates17(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates18(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates19(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates20(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates21(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates22(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates23(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates24(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates25(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates26(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates27(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates28(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates29(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates30(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates31(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates32(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates33(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates34(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates35(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates36(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates37(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates38(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates39(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates40(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates41(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates42(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates43(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates44(ignored, n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates45(ignored, n) {
  const result = n | 0;
  results.push(result);
  return result;
}

function truncates46(n) {
  const result = n | 0;
  results.push(result);
  return result;
}

console.log("strict:", (function () { return this === undefined; })());

truncates1(7);
truncates1(7);
observe("forEach: an integer", () => [(7)].forEach(truncates1));
observe("forEach: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].forEach(truncates1));
observe("forEach: a string", () => [("3")].forEach(truncates1));
observe("forEach: an integer again", () => [(7)].forEach(truncates1));

truncates2(7);
truncates2(7);
observe("map: an integer", () => [(7)].map(truncates2));
observe("map: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].map(truncates2));
observe("map: a string", () => [("3")].map(truncates2));
observe("map: an integer again", () => [(7)].map(truncates2));

truncates3(7);
truncates3(7);
observe("filter: an integer", () => [(7)].filter(truncates3));
observe("filter: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].filter(truncates3));
observe("filter: a string", () => [("3")].filter(truncates3));
observe("filter: an integer again", () => [(7)].filter(truncates3));

truncates4(7);
truncates4(7);
observe("some: an integer", () => [(7)].some(truncates4));
observe("some: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].some(truncates4));
observe("some: a string", () => [("3")].some(truncates4));
observe("some: an integer again", () => [(7)].some(truncates4));

truncates5(7);
truncates5(7);
observe("every: an integer", () => [(7)].every(truncates5));
observe("every: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].every(truncates5));
observe("every: a string", () => [("3")].every(truncates5));
observe("every: an integer again", () => [(7)].every(truncates5));

truncates6(7);
truncates6(7);
observe("find: an integer", () => [(7)].find(truncates6));
observe("find: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].find(truncates6));
observe("find: a string", () => [("3")].find(truncates6));
observe("find: an integer again", () => [(7)].find(truncates6));

truncates7(7);
truncates7(7);
observe("findIndex: an integer", () => [(7)].findIndex(truncates7));
observe("findIndex: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].findIndex(truncates7));
observe("findIndex: a string", () => [("3")].findIndex(truncates7));
observe("findIndex: an integer again", () => [(7)].findIndex(truncates7));

truncates8(7);
truncates8(7);
observe("findLast: an integer", () => [(7)].findLast(truncates8));
observe("findLast: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].findLast(truncates8));
observe("findLast: a string", () => [("3")].findLast(truncates8));
observe("findLast: an integer again", () => [(7)].findLast(truncates8));

truncates9(7);
truncates9(7);
observe("flatMap: an integer", () => [(7)].flatMap(truncates9));
observe("flatMap: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].flatMap(truncates9));
observe("flatMap: a string", () => [("3")].flatMap(truncates9));
observe("flatMap: an integer again", () => [(7)].flatMap(truncates9));

truncates10(7);
truncates10(7);
observe("sort: an integer", () => [(7), (7)].sort(truncates10));
observe("sort: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].sort(truncates10));
observe("sort: a string", () => [("3"), ("3")].sort(truncates10));
observe("sort: an integer again", () => [(7), (7)].sort(truncates10));

truncates11(7);
truncates11(7);
observe("toSorted: an integer", () => [(7), (7)].toSorted(truncates11));
observe("toSorted: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].toSorted(truncates11));
observe("toSorted: a string", () => [("3"), ("3")].toSorted(truncates11));
observe("toSorted: an integer again", () => [(7), (7)].toSorted(truncates11));

truncates12(7);
truncates12(7);
observe("reduce with a first value: an integer", () => [0].reduce(truncates12, (7)));
observe("reduce with a first value: an object with valueOf", () => [0].reduce(truncates12, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))));
observe("reduce with a first value: a string", () => [0].reduce(truncates12, ("3")));
observe("reduce with a first value: an integer again", () => [0].reduce(truncates12, (7)));

truncates13(7);
truncates13(7);
observe("reduce without a first value: an integer", () => [(7), 0].reduce(truncates13));
observe("reduce without a first value: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), 0].reduce(truncates13));
observe("reduce without a first value: a string", () => [("3"), 0].reduce(truncates13));
observe("reduce without a first value: an integer again", () => [(7), 0].reduce(truncates13));

truncates14(7);
truncates14(7);
observe("reduceRight: an integer", () => [0].reduceRight(truncates14, (7)));
observe("reduceRight: an object with valueOf", () => [0].reduceRight(truncates14, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))));
observe("reduceRight: a string", () => [0].reduceRight(truncates14, ("3")));
observe("reduceRight: an integer again", () => [0].reduceRight(truncates14, (7)));

truncates15(7);
truncates15(7);
observe("Array.from of an array: an integer", () => Array.from([(7)], truncates15));
observe("Array.from of an array: an object with valueOf", () => Array.from([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))], truncates15));
observe("Array.from of an array: a string", () => Array.from([("3")], truncates15));
observe("Array.from of an array: an integer again", () => Array.from([(7)], truncates15));

truncates16(7);
truncates16(7);
observe("Array.from of an array-like: an integer", () => Array.from({ length: 1, 0: (7) }, truncates16));
observe("Array.from of an array-like: an object with valueOf", () => Array.from({ length: 1, 0: (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })) }, truncates16));
observe("Array.from of an array-like: a string", () => Array.from({ length: 1, 0: ("3") }, truncates16));
observe("Array.from of an array-like: an integer again", () => Array.from({ length: 1, 0: (7) }, truncates16));

truncates17(7);
truncates17(7);
observe("Array.from of a set: an integer", () => Array.from(new Set([(7)]), truncates17));
observe("Array.from of a set: an object with valueOf", () => Array.from(new Set([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]), truncates17));
observe("Array.from of a set: a string", () => Array.from(new Set([("3")]), truncates17));
observe("Array.from of a set: an integer again", () => Array.from(new Set([(7)]), truncates17));

truncates18(7);
truncates18(7);
observe("forEach of an array-like: an integer", () => Array.prototype.forEach.call({ length: 1, 0: (7) }, truncates18));
observe("forEach of an array-like: an object with valueOf", () => Array.prototype.forEach.call({ length: 1, 0: (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })) }, truncates18));
observe("forEach of an array-like: a string", () => Array.prototype.forEach.call({ length: 1, 0: ("3") }, truncates18));
observe("forEach of an array-like: an integer again", () => Array.prototype.forEach.call({ length: 1, 0: (7) }, truncates18));

truncates19(7);
truncates19(7);
observe("forEach of a set: an integer", () => new Set([(7)]).forEach(truncates19));
observe("forEach of a set: an object with valueOf", () => new Set([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]).forEach(truncates19));
observe("forEach of a set: a string", () => new Set([("3")]).forEach(truncates19));
observe("forEach of a set: an integer again", () => new Set([(7)]).forEach(truncates19));

truncates20(7);
truncates20(7);
observe("forEach of a map: an integer", () => new Map([[0, (7)]]).forEach(truncates20));
observe("forEach of a map: an object with valueOf", () => new Map([[0, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]]).forEach(truncates20));
observe("forEach of a map: a string", () => new Map([[0, ("3")]]).forEach(truncates20));
observe("forEach of a map: an integer again", () => new Map([[0, (7)]]).forEach(truncates20));

truncates21(7);
truncates21(7);
observe("map of an iterator: an integer", () => [(7)].values().map(truncates21).toArray());
observe("map of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().map(truncates21).toArray());
observe("map of an iterator: a string", () => [("3")].values().map(truncates21).toArray());
observe("map of an iterator: an integer again", () => [(7)].values().map(truncates21).toArray());

truncates22(7);
truncates22(7);
observe("forEach of an iterator: an integer", () => [(7)].values().forEach(truncates22));
observe("forEach of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().forEach(truncates22));
observe("forEach of an iterator: a string", () => [("3")].values().forEach(truncates22));
observe("forEach of an iterator: an integer again", () => [(7)].values().forEach(truncates22));

truncates23(7);
truncates23(7);
observe("reduce of an iterator: an integer", () => [0].values().reduce(truncates23, (7)));
observe("reduce of an iterator: an object with valueOf", () => [0].values().reduce(truncates23, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))));
observe("reduce of an iterator: a string", () => [0].values().reduce(truncates23, ("3")));
observe("reduce of an iterator: an integer again", () => [0].values().reduce(truncates23, (7)));

truncates24(7);
truncates24(7);
observe("filter of an iterator: an integer", () => [(7)].values().filter(truncates24).toArray());
observe("filter of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().filter(truncates24).toArray());
observe("filter of an iterator: a string", () => [("3")].values().filter(truncates24).toArray());
observe("filter of an iterator: an integer again", () => [(7)].values().filter(truncates24).toArray());

truncates25(7);
truncates25(7);
observe("find of an iterator: an integer", () => [(7)].values().find(truncates25));
observe("find of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().find(truncates25));
observe("find of an iterator: a string", () => [("3")].values().find(truncates25));
observe("find of an iterator: an integer again", () => [(7)].values().find(truncates25));

truncates26(7);
truncates26(7);
observe("some of an iterator: an integer", () => [(7)].values().some(truncates26));
observe("some of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().some(truncates26));
observe("some of an iterator: a string", () => [("3")].values().some(truncates26));
observe("some of an iterator: an integer again", () => [(7)].values().some(truncates26));

truncates27(7);
truncates27(7);
observe("every of an iterator: an integer", () => [(7)].values().every(truncates27));
observe("every of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().every(truncates27));
observe("every of an iterator: a string", () => [("3")].values().every(truncates27));
observe("every of an iterator: an integer again", () => [(7)].values().every(truncates27));

truncates28(7);
truncates28(7);
observe("findLastIndex: an integer", () => [(7)].findLastIndex(truncates28));
observe("findLastIndex: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].findLastIndex(truncates28));
observe("findLastIndex: a string", () => [("3")].findLastIndex(truncates28));
observe("findLastIndex: an integer again", () => [(7)].findLastIndex(truncates28));

truncates29(7);
truncates29(7);
observe("a typed array made from a list: an integer", () => Uint8Array.from([(7)], truncates29));
observe("a typed array made from a list: an object with valueOf", () => Uint8Array.from([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))], truncates29));
observe("a typed array made from a list: a string", () => Uint8Array.from([("3")], truncates29));
observe("a typed array made from a list: an integer again", () => Uint8Array.from([(7)], truncates29));

truncates30(7);
truncates30(7);
observe("adopt of a disposable stack: an integer", () => (stack => (stack.adopt((7), truncates30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an object with valueOf", () => (stack => (stack.adopt((({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), truncates30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: a string", () => (stack => (stack.adopt(("3"), truncates30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an integer again", () => (stack => (stack.adopt((7), truncates30), stack.dispose()))(new DisposableStack()));

truncates31(7);
truncates31(7);
observe("getOrInsertComputed of a map: an integer", () => new Map().getOrInsertComputed((7), truncates31));
observe("getOrInsertComputed of a map: an object with valueOf", () => new Map().getOrInsertComputed((({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), truncates31));
observe("getOrInsertComputed of a map: a string", () => new Map().getOrInsertComputed(("3"), truncates31));
observe("getOrInsertComputed of a map: an integer again", () => new Map().getOrInsertComputed((7), truncates31));

truncates32(7);
truncates32(7);
observe("Object.groupBy: an integer", () => Object.groupBy([(7)], truncates32));
observe("Object.groupBy: an object with valueOf", () => Object.groupBy([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))], truncates32));
observe("Object.groupBy: a string", () => Object.groupBy([("3")], truncates32));
observe("Object.groupBy: an integer again", () => Object.groupBy([(7)], truncates32));

truncates33(7);
truncates33(7);
observe("Map.groupBy: an integer", () => Map.groupBy([(7)], truncates33));
observe("Map.groupBy: an object with valueOf", () => Map.groupBy([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))], truncates33));
observe("Map.groupBy: a string", () => Map.groupBy([("3")], truncates33));
observe("Map.groupBy: an integer again", () => Map.groupBy([(7)], truncates33));

truncates34(7);
truncates34(7);
observe("Reflect.apply: an integer", () => Reflect.apply(truncates34, undefined, [(7)]));
observe("Reflect.apply: an object with valueOf", () => Reflect.apply(truncates34, undefined, [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]));
observe("Reflect.apply: a string", () => Reflect.apply(truncates34, undefined, [("3")]));
observe("Reflect.apply: an integer again", () => Reflect.apply(truncates34, undefined, [(7)]));

truncates35(7);
truncates35(7);
observe("Reflect.apply with an array-like: an integer", () => Reflect.apply(truncates35, undefined, { length: 1, 0: (7) }));
observe("Reflect.apply with an array-like: an object with valueOf", () => Reflect.apply(truncates35, undefined, { length: 1, 0: (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })) }));
observe("Reflect.apply with an array-like: a string", () => Reflect.apply(truncates35, undefined, { length: 1, 0: ("3") }));
observe("Reflect.apply with an array-like: an integer again", () => Reflect.apply(truncates35, undefined, { length: 1, 0: (7) }));

truncates36(7);
truncates36(7);
observe("Reflect.construct: an integer", () => Reflect.construct(truncates36, [(7)]));
observe("Reflect.construct: an object with valueOf", () => Reflect.construct(truncates36, [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]));
observe("Reflect.construct: a string", () => Reflect.construct(truncates36, [("3")]));
observe("Reflect.construct: an integer again", () => Reflect.construct(truncates36, [(7)]));

truncates37(7);
truncates37(7);
observe("call: an integer", () => truncates37.call(undefined, (7)));
observe("call: an object with valueOf", () => truncates37.call(undefined, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))));
observe("call: a string", () => truncates37.call(undefined, ("3")));
observe("call: an integer again", () => truncates37.call(undefined, (7)));

truncates38(7);
truncates38(7);
observe("apply: an integer", () => truncates38.apply(undefined, [(7)]));
observe("apply: an object with valueOf", () => truncates38.apply(undefined, [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]));
observe("apply: a string", () => truncates38.apply(undefined, [("3")]));
observe("apply: an integer again", () => truncates38.apply(undefined, [(7)]));

truncates39(7);
truncates39(7);
observe("bind: an integer", () => truncates39.bind(undefined, (7))());
observe("bind: an object with valueOf", () => truncates39.bind(undefined, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })))());
observe("bind: a string", () => truncates39.bind(undefined, ("3"))());
observe("bind: an integer again", () => truncates39.bind(undefined, (7))());

truncates40(7);
truncates40(7);
observe("a setter: an integer", () => Object.defineProperty({}, "key", { set: truncates40 }).key = (7));
observe("a setter: an object with valueOf", () => Object.defineProperty({}, "key", { set: truncates40 }).key = (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })));
observe("a setter: a string", () => Object.defineProperty({}, "key", { set: truncates40 }).key = ("3"));
observe("a setter: an integer again", () => Object.defineProperty({}, "key", { set: truncates40 }).key = (7));

truncates41(7);
truncates41(7);
observe("Symbol.hasInstance: an integer", () => (7) instanceof { [Symbol.hasInstance]: truncates41 });
observe("Symbol.hasInstance: an object with valueOf", () => (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })) instanceof { [Symbol.hasInstance]: truncates41 });
observe("Symbol.hasInstance: a string", () => ("3") instanceof { [Symbol.hasInstance]: truncates41 });
observe("Symbol.hasInstance: an integer again", () => (7) instanceof { [Symbol.hasInstance]: truncates41 });

truncates42(7);
truncates42(7);
observe("the set trap of a proxy: an integer", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(truncates42, undefined, [value]), true) }).key = (7));
observe("the set trap of a proxy: an object with valueOf", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(truncates42, undefined, [value]), true) }).key = (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })));
observe("the set trap of a proxy: a string", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(truncates42, undefined, [value]), true) }).key = ("3"));
observe("the set trap of a proxy: an integer again", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(truncates42, undefined, [value]), true) }).key = (7));

truncates43(7);
truncates43(7);
observe("a replacer of JSON.stringify: an integer", () => JSON.stringify(0, () => void [(7)].forEach(truncates43)));
observe("a replacer of JSON.stringify: an object with valueOf", () => JSON.stringify(0, () => void [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].forEach(truncates43)));
observe("a replacer of JSON.stringify: a string", () => JSON.stringify(0, () => void [("3")].forEach(truncates43)));
observe("a replacer of JSON.stringify: an integer again", () => JSON.stringify(0, () => void [(7)].forEach(truncates43)));

truncates44(0, 7);
truncates44(0, 7);
observe("a tagged template: an integer", () => truncates44.bind(undefined)`${(7)}`);
observe("a tagged template: an object with valueOf", () => truncates44.bind(undefined)`${(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))}`);
observe("a tagged template: a string", () => truncates44.bind(undefined)`${("3")}`);
observe("a tagged template: an integer again", () => truncates44.bind(undefined)`${(7)}`);

truncates45(0, 7);
truncates45(0, 7);
observe("a replacer of JSON.stringify, second parameter: an integer", () => JSON.stringify((7), truncates45));
observe("a replacer of JSON.stringify, second parameter: an object with valueOf", () => JSON.stringify((({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), truncates45));
observe("a replacer of JSON.stringify, second parameter: a string", () => JSON.stringify(("3"), truncates45));
observe("a replacer of JSON.stringify, second parameter: an integer again", () => JSON.stringify((7), truncates45));

truncates46(7);
truncates46(7);
observe("a listener of an event emitter: an integer", () => new (require("node:events").EventEmitter)().once("value", truncates46).emit("value", (7)));
observe("a listener of an event emitter: an object with valueOf", () => new (require("node:events").EventEmitter)().once("value", truncates46).emit("value", (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))));
observe("a listener of an event emitter: a string", () => new (require("node:events").EventEmitter)().once("value", truncates46).emit("value", ("3")));
observe("a listener of an event emitter: an integer again", () => new (require("node:events").EventEmitter)().once("value", truncates46).emit("value", (7)));
