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

function addsOne1(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne2(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne3(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne4(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne5(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne6(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne7(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne8(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne9(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne10(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne11(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne12(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne13(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne14(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne15(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne16(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne17(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne18(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne19(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne20(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne21(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne22(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne23(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne24(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne25(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne26(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne27(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne28(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne29(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne30(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne31(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne32(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne33(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne34(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne35(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne36(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne37(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne38(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne39(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne40(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne41(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne42(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne43(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne44(ignored, n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne45(ignored, n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne46(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

console.log("strict:", (function () { return this === undefined; })());

addsOne1(7);
addsOne1(7);
observe("forEach: an integer", () => [(7)].forEach(addsOne1));
observe("forEach: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].forEach(addsOne1));
observe("forEach: a string", () => [("3")].forEach(addsOne1));
observe("forEach: an integer again", () => [(7)].forEach(addsOne1));

addsOne2(7);
addsOne2(7);
observe("map: an integer", () => [(7)].map(addsOne2));
observe("map: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].map(addsOne2));
observe("map: a string", () => [("3")].map(addsOne2));
observe("map: an integer again", () => [(7)].map(addsOne2));

addsOne3(7);
addsOne3(7);
observe("filter: an integer", () => [(7)].filter(addsOne3));
observe("filter: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].filter(addsOne3));
observe("filter: a string", () => [("3")].filter(addsOne3));
observe("filter: an integer again", () => [(7)].filter(addsOne3));

addsOne4(7);
addsOne4(7);
observe("some: an integer", () => [(7)].some(addsOne4));
observe("some: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].some(addsOne4));
observe("some: a string", () => [("3")].some(addsOne4));
observe("some: an integer again", () => [(7)].some(addsOne4));

addsOne5(7);
addsOne5(7);
observe("every: an integer", () => [(7)].every(addsOne5));
observe("every: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].every(addsOne5));
observe("every: a string", () => [("3")].every(addsOne5));
observe("every: an integer again", () => [(7)].every(addsOne5));

addsOne6(7);
addsOne6(7);
observe("find: an integer", () => [(7)].find(addsOne6));
observe("find: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].find(addsOne6));
observe("find: a string", () => [("3")].find(addsOne6));
observe("find: an integer again", () => [(7)].find(addsOne6));

addsOne7(7);
addsOne7(7);
observe("findIndex: an integer", () => [(7)].findIndex(addsOne7));
observe("findIndex: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].findIndex(addsOne7));
observe("findIndex: a string", () => [("3")].findIndex(addsOne7));
observe("findIndex: an integer again", () => [(7)].findIndex(addsOne7));

addsOne8(7);
addsOne8(7);
observe("findLast: an integer", () => [(7)].findLast(addsOne8));
observe("findLast: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].findLast(addsOne8));
observe("findLast: a string", () => [("3")].findLast(addsOne8));
observe("findLast: an integer again", () => [(7)].findLast(addsOne8));

addsOne9(7);
addsOne9(7);
observe("flatMap: an integer", () => [(7)].flatMap(addsOne9));
observe("flatMap: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].flatMap(addsOne9));
observe("flatMap: a string", () => [("3")].flatMap(addsOne9));
observe("flatMap: an integer again", () => [(7)].flatMap(addsOne9));

addsOne10(7);
addsOne10(7);
observe("sort: an integer", () => [(7), (7)].sort(addsOne10));
observe("sort: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].sort(addsOne10));
observe("sort: a string", () => [("3"), ("3")].sort(addsOne10));
observe("sort: an integer again", () => [(7), (7)].sort(addsOne10));

addsOne11(7);
addsOne11(7);
observe("toSorted: an integer", () => [(7), (7)].toSorted(addsOne11));
observe("toSorted: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].toSorted(addsOne11));
observe("toSorted: a string", () => [("3"), ("3")].toSorted(addsOne11));
observe("toSorted: an integer again", () => [(7), (7)].toSorted(addsOne11));

addsOne12(7);
addsOne12(7);
observe("reduce with a first value: an integer", () => [0].reduce(addsOne12, (7)));
observe("reduce with a first value: an object with valueOf", () => [0].reduce(addsOne12, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))));
observe("reduce with a first value: a string", () => [0].reduce(addsOne12, ("3")));
observe("reduce with a first value: an integer again", () => [0].reduce(addsOne12, (7)));

addsOne13(7);
addsOne13(7);
observe("reduce without a first value: an integer", () => [(7), 0].reduce(addsOne13));
observe("reduce without a first value: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), 0].reduce(addsOne13));
observe("reduce without a first value: a string", () => [("3"), 0].reduce(addsOne13));
observe("reduce without a first value: an integer again", () => [(7), 0].reduce(addsOne13));

addsOne14(7);
addsOne14(7);
observe("reduceRight: an integer", () => [0].reduceRight(addsOne14, (7)));
observe("reduceRight: an object with valueOf", () => [0].reduceRight(addsOne14, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))));
observe("reduceRight: a string", () => [0].reduceRight(addsOne14, ("3")));
observe("reduceRight: an integer again", () => [0].reduceRight(addsOne14, (7)));

addsOne15(7);
addsOne15(7);
observe("Array.from of an array: an integer", () => Array.from([(7)], addsOne15));
observe("Array.from of an array: an object with valueOf", () => Array.from([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))], addsOne15));
observe("Array.from of an array: a string", () => Array.from([("3")], addsOne15));
observe("Array.from of an array: an integer again", () => Array.from([(7)], addsOne15));

addsOne16(7);
addsOne16(7);
observe("Array.from of an array-like: an integer", () => Array.from({ length: 1, 0: (7) }, addsOne16));
observe("Array.from of an array-like: an object with valueOf", () => Array.from({ length: 1, 0: (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })) }, addsOne16));
observe("Array.from of an array-like: a string", () => Array.from({ length: 1, 0: ("3") }, addsOne16));
observe("Array.from of an array-like: an integer again", () => Array.from({ length: 1, 0: (7) }, addsOne16));

addsOne17(7);
addsOne17(7);
observe("Array.from of a set: an integer", () => Array.from(new Set([(7)]), addsOne17));
observe("Array.from of a set: an object with valueOf", () => Array.from(new Set([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]), addsOne17));
observe("Array.from of a set: a string", () => Array.from(new Set([("3")]), addsOne17));
observe("Array.from of a set: an integer again", () => Array.from(new Set([(7)]), addsOne17));

addsOne18(7);
addsOne18(7);
observe("forEach of an array-like: an integer", () => Array.prototype.forEach.call({ length: 1, 0: (7) }, addsOne18));
observe("forEach of an array-like: an object with valueOf", () => Array.prototype.forEach.call({ length: 1, 0: (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })) }, addsOne18));
observe("forEach of an array-like: a string", () => Array.prototype.forEach.call({ length: 1, 0: ("3") }, addsOne18));
observe("forEach of an array-like: an integer again", () => Array.prototype.forEach.call({ length: 1, 0: (7) }, addsOne18));

addsOne19(7);
addsOne19(7);
observe("forEach of a set: an integer", () => new Set([(7)]).forEach(addsOne19));
observe("forEach of a set: an object with valueOf", () => new Set([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]).forEach(addsOne19));
observe("forEach of a set: a string", () => new Set([("3")]).forEach(addsOne19));
observe("forEach of a set: an integer again", () => new Set([(7)]).forEach(addsOne19));

addsOne20(7);
addsOne20(7);
observe("forEach of a map: an integer", () => new Map([[0, (7)]]).forEach(addsOne20));
observe("forEach of a map: an object with valueOf", () => new Map([[0, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]]).forEach(addsOne20));
observe("forEach of a map: a string", () => new Map([[0, ("3")]]).forEach(addsOne20));
observe("forEach of a map: an integer again", () => new Map([[0, (7)]]).forEach(addsOne20));

addsOne21(7);
addsOne21(7);
observe("map of an iterator: an integer", () => [(7)].values().map(addsOne21).toArray());
observe("map of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().map(addsOne21).toArray());
observe("map of an iterator: a string", () => [("3")].values().map(addsOne21).toArray());
observe("map of an iterator: an integer again", () => [(7)].values().map(addsOne21).toArray());

addsOne22(7);
addsOne22(7);
observe("forEach of an iterator: an integer", () => [(7)].values().forEach(addsOne22));
observe("forEach of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().forEach(addsOne22));
observe("forEach of an iterator: a string", () => [("3")].values().forEach(addsOne22));
observe("forEach of an iterator: an integer again", () => [(7)].values().forEach(addsOne22));

addsOne23(7);
addsOne23(7);
observe("reduce of an iterator: an integer", () => [0].values().reduce(addsOne23, (7)));
observe("reduce of an iterator: an object with valueOf", () => [0].values().reduce(addsOne23, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))));
observe("reduce of an iterator: a string", () => [0].values().reduce(addsOne23, ("3")));
observe("reduce of an iterator: an integer again", () => [0].values().reduce(addsOne23, (7)));

addsOne24(7);
addsOne24(7);
observe("filter of an iterator: an integer", () => [(7)].values().filter(addsOne24).toArray());
observe("filter of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().filter(addsOne24).toArray());
observe("filter of an iterator: a string", () => [("3")].values().filter(addsOne24).toArray());
observe("filter of an iterator: an integer again", () => [(7)].values().filter(addsOne24).toArray());

addsOne25(7);
addsOne25(7);
observe("find of an iterator: an integer", () => [(7)].values().find(addsOne25));
observe("find of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().find(addsOne25));
observe("find of an iterator: a string", () => [("3")].values().find(addsOne25));
observe("find of an iterator: an integer again", () => [(7)].values().find(addsOne25));

addsOne26(7);
addsOne26(7);
observe("some of an iterator: an integer", () => [(7)].values().some(addsOne26));
observe("some of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().some(addsOne26));
observe("some of an iterator: a string", () => [("3")].values().some(addsOne26));
observe("some of an iterator: an integer again", () => [(7)].values().some(addsOne26));

addsOne27(7);
addsOne27(7);
observe("every of an iterator: an integer", () => [(7)].values().every(addsOne27));
observe("every of an iterator: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].values().every(addsOne27));
observe("every of an iterator: a string", () => [("3")].values().every(addsOne27));
observe("every of an iterator: an integer again", () => [(7)].values().every(addsOne27));

addsOne28(7);
addsOne28(7);
observe("findLastIndex: an integer", () => [(7)].findLastIndex(addsOne28));
observe("findLastIndex: an object with valueOf", () => [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].findLastIndex(addsOne28));
observe("findLastIndex: a string", () => [("3")].findLastIndex(addsOne28));
observe("findLastIndex: an integer again", () => [(7)].findLastIndex(addsOne28));

addsOne29(7);
addsOne29(7);
observe("a typed array made from a list: an integer", () => Uint8Array.from([(7)], addsOne29));
observe("a typed array made from a list: an object with valueOf", () => Uint8Array.from([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))], addsOne29));
observe("a typed array made from a list: a string", () => Uint8Array.from([("3")], addsOne29));
observe("a typed array made from a list: an integer again", () => Uint8Array.from([(7)], addsOne29));

addsOne30(7);
addsOne30(7);
observe("adopt of a disposable stack: an integer", () => (stack => (stack.adopt((7), addsOne30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an object with valueOf", () => (stack => (stack.adopt((({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), addsOne30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: a string", () => (stack => (stack.adopt(("3"), addsOne30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an integer again", () => (stack => (stack.adopt((7), addsOne30), stack.dispose()))(new DisposableStack()));

addsOne31(7);
addsOne31(7);
observe("getOrInsertComputed of a map: an integer", () => new Map().getOrInsertComputed((7), addsOne31));
observe("getOrInsertComputed of a map: an object with valueOf", () => new Map().getOrInsertComputed((({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), addsOne31));
observe("getOrInsertComputed of a map: a string", () => new Map().getOrInsertComputed(("3"), addsOne31));
observe("getOrInsertComputed of a map: an integer again", () => new Map().getOrInsertComputed((7), addsOne31));

addsOne32(7);
addsOne32(7);
observe("Object.groupBy: an integer", () => Object.groupBy([(7)], addsOne32));
observe("Object.groupBy: an object with valueOf", () => Object.groupBy([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))], addsOne32));
observe("Object.groupBy: a string", () => Object.groupBy([("3")], addsOne32));
observe("Object.groupBy: an integer again", () => Object.groupBy([(7)], addsOne32));

addsOne33(7);
addsOne33(7);
observe("Map.groupBy: an integer", () => Map.groupBy([(7)], addsOne33));
observe("Map.groupBy: an object with valueOf", () => Map.groupBy([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))], addsOne33));
observe("Map.groupBy: a string", () => Map.groupBy([("3")], addsOne33));
observe("Map.groupBy: an integer again", () => Map.groupBy([(7)], addsOne33));

addsOne34(7);
addsOne34(7);
observe("Reflect.apply: an integer", () => Reflect.apply(addsOne34, undefined, [(7)]));
observe("Reflect.apply: an object with valueOf", () => Reflect.apply(addsOne34, undefined, [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]));
observe("Reflect.apply: a string", () => Reflect.apply(addsOne34, undefined, [("3")]));
observe("Reflect.apply: an integer again", () => Reflect.apply(addsOne34, undefined, [(7)]));

addsOne35(7);
addsOne35(7);
observe("Reflect.apply with an array-like: an integer", () => Reflect.apply(addsOne35, undefined, { length: 1, 0: (7) }));
observe("Reflect.apply with an array-like: an object with valueOf", () => Reflect.apply(addsOne35, undefined, { length: 1, 0: (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })) }));
observe("Reflect.apply with an array-like: a string", () => Reflect.apply(addsOne35, undefined, { length: 1, 0: ("3") }));
observe("Reflect.apply with an array-like: an integer again", () => Reflect.apply(addsOne35, undefined, { length: 1, 0: (7) }));

addsOne36(7);
addsOne36(7);
observe("Reflect.construct: an integer", () => Reflect.construct(addsOne36, [(7)]));
observe("Reflect.construct: an object with valueOf", () => Reflect.construct(addsOne36, [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]));
observe("Reflect.construct: a string", () => Reflect.construct(addsOne36, [("3")]));
observe("Reflect.construct: an integer again", () => Reflect.construct(addsOne36, [(7)]));

addsOne37(7);
addsOne37(7);
observe("call: an integer", () => addsOne37.call(undefined, (7)));
observe("call: an object with valueOf", () => addsOne37.call(undefined, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))));
observe("call: a string", () => addsOne37.call(undefined, ("3")));
observe("call: an integer again", () => addsOne37.call(undefined, (7)));

addsOne38(7);
addsOne38(7);
observe("apply: an integer", () => addsOne38.apply(undefined, [(7)]));
observe("apply: an object with valueOf", () => addsOne38.apply(undefined, [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))]));
observe("apply: a string", () => addsOne38.apply(undefined, [("3")]));
observe("apply: an integer again", () => addsOne38.apply(undefined, [(7)]));

addsOne39(7);
addsOne39(7);
observe("bind: an integer", () => addsOne39.bind(undefined, (7))());
observe("bind: an object with valueOf", () => addsOne39.bind(undefined, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })))());
observe("bind: a string", () => addsOne39.bind(undefined, ("3"))());
observe("bind: an integer again", () => addsOne39.bind(undefined, (7))());

addsOne40(7);
addsOne40(7);
observe("a setter: an integer", () => Object.defineProperty({}, "key", { set: addsOne40 }).key = (7));
observe("a setter: an object with valueOf", () => Object.defineProperty({}, "key", { set: addsOne40 }).key = (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })));
observe("a setter: a string", () => Object.defineProperty({}, "key", { set: addsOne40 }).key = ("3"));
observe("a setter: an integer again", () => Object.defineProperty({}, "key", { set: addsOne40 }).key = (7));

addsOne41(7);
addsOne41(7);
observe("Symbol.hasInstance: an integer", () => (7) instanceof { [Symbol.hasInstance]: addsOne41 });
observe("Symbol.hasInstance: an object with valueOf", () => (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })) instanceof { [Symbol.hasInstance]: addsOne41 });
observe("Symbol.hasInstance: a string", () => ("3") instanceof { [Symbol.hasInstance]: addsOne41 });
observe("Symbol.hasInstance: an integer again", () => (7) instanceof { [Symbol.hasInstance]: addsOne41 });

addsOne42(7);
addsOne42(7);
observe("the set trap of a proxy: an integer", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(addsOne42, undefined, [value]), true) }).key = (7));
observe("the set trap of a proxy: an object with valueOf", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(addsOne42, undefined, [value]), true) }).key = (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })));
observe("the set trap of a proxy: a string", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(addsOne42, undefined, [value]), true) }).key = ("3"));
observe("the set trap of a proxy: an integer again", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(addsOne42, undefined, [value]), true) }).key = (7));

addsOne43(7);
addsOne43(7);
observe("a replacer of JSON.stringify: an integer", () => JSON.stringify(0, () => void [(7)].forEach(addsOne43)));
observe("a replacer of JSON.stringify: an object with valueOf", () => JSON.stringify(0, () => void [(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))].forEach(addsOne43)));
observe("a replacer of JSON.stringify: a string", () => JSON.stringify(0, () => void [("3")].forEach(addsOne43)));
observe("a replacer of JSON.stringify: an integer again", () => JSON.stringify(0, () => void [(7)].forEach(addsOne43)));

addsOne44(0, 7);
addsOne44(0, 7);
observe("a tagged template: an integer", () => addsOne44.bind(undefined)`${(7)}`);
observe("a tagged template: an object with valueOf", () => addsOne44.bind(undefined)`${(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))}`);
observe("a tagged template: a string", () => addsOne44.bind(undefined)`${("3")}`);
observe("a tagged template: an integer again", () => addsOne44.bind(undefined)`${(7)}`);

addsOne45(0, 7);
addsOne45(0, 7);
observe("a replacer of JSON.stringify, second parameter: an integer", () => JSON.stringify((7), addsOne45));
observe("a replacer of JSON.stringify, second parameter: an object with valueOf", () => JSON.stringify((({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })), addsOne45));
observe("a replacer of JSON.stringify, second parameter: a string", () => JSON.stringify(("3"), addsOne45));
observe("a replacer of JSON.stringify, second parameter: an integer again", () => JSON.stringify((7), addsOne45));

addsOne46(7);
addsOne46(7);
observe("a listener of an event emitter: an integer", () => new (require("node:events").EventEmitter)().once("value", addsOne46).emit("value", (7)));
observe("a listener of an event emitter: an object with valueOf", () => new (require("node:events").EventEmitter)().once("value", addsOne46).emit("value", (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))));
observe("a listener of an event emitter: a string", () => new (require("node:events").EventEmitter)().once("value", addsOne46).emit("value", ("3")));
observe("a listener of an event emitter: an integer again", () => new (require("node:events").EventEmitter)().once("value", addsOne46).emit("value", (7)));
