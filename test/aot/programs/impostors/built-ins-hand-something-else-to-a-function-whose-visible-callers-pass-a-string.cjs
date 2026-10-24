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

function readsCharCode1(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode2(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode3(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode4(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode5(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode6(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode7(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode8(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode9(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode10(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode11(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode12(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode13(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode14(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode15(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode16(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode17(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode18(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode19(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode20(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode21(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode22(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode23(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode24(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode25(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode26(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode27(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode28(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode29(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode30(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode31(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode32(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode33(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode34(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode35(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode36(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode37(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode38(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode39(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode40(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode41(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode42(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode43(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode44(ignored, s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode45(ignored, s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

function readsCharCode46(s) {
  const result = s.charCodeAt(0);
  results.push(result);
  return result;
}

console.log("strict:", (function () { return this === undefined; })());

readsCharCode1("abc");
readsCharCode1("abc");
observe("forEach: a string", () => [("abc")].forEach(readsCharCode1));
observe("forEach: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].forEach(readsCharCode1));
observe("forEach: an array", () => [(["abc"])].forEach(readsCharCode1));
observe("forEach: a string again", () => [("abc")].forEach(readsCharCode1));

readsCharCode2("abc");
readsCharCode2("abc");
observe("map: a string", () => [("abc")].map(readsCharCode2));
observe("map: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].map(readsCharCode2));
observe("map: an array", () => [(["abc"])].map(readsCharCode2));
observe("map: a string again", () => [("abc")].map(readsCharCode2));

readsCharCode3("abc");
readsCharCode3("abc");
observe("filter: a string", () => [("abc")].filter(readsCharCode3));
observe("filter: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].filter(readsCharCode3));
observe("filter: an array", () => [(["abc"])].filter(readsCharCode3));
observe("filter: a string again", () => [("abc")].filter(readsCharCode3));

readsCharCode4("abc");
readsCharCode4("abc");
observe("some: a string", () => [("abc")].some(readsCharCode4));
observe("some: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].some(readsCharCode4));
observe("some: an array", () => [(["abc"])].some(readsCharCode4));
observe("some: a string again", () => [("abc")].some(readsCharCode4));

readsCharCode5("abc");
readsCharCode5("abc");
observe("every: a string", () => [("abc")].every(readsCharCode5));
observe("every: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].every(readsCharCode5));
observe("every: an array", () => [(["abc"])].every(readsCharCode5));
observe("every: a string again", () => [("abc")].every(readsCharCode5));

readsCharCode6("abc");
readsCharCode6("abc");
observe("find: a string", () => [("abc")].find(readsCharCode6));
observe("find: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].find(readsCharCode6));
observe("find: an array", () => [(["abc"])].find(readsCharCode6));
observe("find: a string again", () => [("abc")].find(readsCharCode6));

readsCharCode7("abc");
readsCharCode7("abc");
observe("findIndex: a string", () => [("abc")].findIndex(readsCharCode7));
observe("findIndex: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].findIndex(readsCharCode7));
observe("findIndex: an array", () => [(["abc"])].findIndex(readsCharCode7));
observe("findIndex: a string again", () => [("abc")].findIndex(readsCharCode7));

readsCharCode8("abc");
readsCharCode8("abc");
observe("findLast: a string", () => [("abc")].findLast(readsCharCode8));
observe("findLast: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].findLast(readsCharCode8));
observe("findLast: an array", () => [(["abc"])].findLast(readsCharCode8));
observe("findLast: a string again", () => [("abc")].findLast(readsCharCode8));

readsCharCode9("abc");
readsCharCode9("abc");
observe("flatMap: a string", () => [("abc")].flatMap(readsCharCode9));
observe("flatMap: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].flatMap(readsCharCode9));
observe("flatMap: an array", () => [(["abc"])].flatMap(readsCharCode9));
observe("flatMap: a string again", () => [("abc")].flatMap(readsCharCode9));

readsCharCode10("abc");
readsCharCode10("abc");
observe("sort: a string", () => [("abc"), ("abc")].sort(readsCharCode10));
observe("sort: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })), (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].sort(readsCharCode10));
observe("sort: an array", () => [(["abc"]), (["abc"])].sort(readsCharCode10));
observe("sort: a string again", () => [("abc"), ("abc")].sort(readsCharCode10));

readsCharCode11("abc");
readsCharCode11("abc");
observe("toSorted: a string", () => [("abc"), ("abc")].toSorted(readsCharCode11));
observe("toSorted: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })), (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].toSorted(readsCharCode11));
observe("toSorted: an array", () => [(["abc"]), (["abc"])].toSorted(readsCharCode11));
observe("toSorted: a string again", () => [("abc"), ("abc")].toSorted(readsCharCode11));

readsCharCode12("abc");
readsCharCode12("abc");
observe("reduce with a first value: a string", () => [0].reduce(readsCharCode12, ("abc")));
observe("reduce with a first value: an object with charCodeAt", () => [0].reduce(readsCharCode12, (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))));
observe("reduce with a first value: an array", () => [0].reduce(readsCharCode12, (["abc"])));
observe("reduce with a first value: a string again", () => [0].reduce(readsCharCode12, ("abc")));

readsCharCode13("abc");
readsCharCode13("abc");
observe("reduce without a first value: a string", () => [("abc"), 0].reduce(readsCharCode13));
observe("reduce without a first value: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })), 0].reduce(readsCharCode13));
observe("reduce without a first value: an array", () => [(["abc"]), 0].reduce(readsCharCode13));
observe("reduce without a first value: a string again", () => [("abc"), 0].reduce(readsCharCode13));

readsCharCode14("abc");
readsCharCode14("abc");
observe("reduceRight: a string", () => [0].reduceRight(readsCharCode14, ("abc")));
observe("reduceRight: an object with charCodeAt", () => [0].reduceRight(readsCharCode14, (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))));
observe("reduceRight: an array", () => [0].reduceRight(readsCharCode14, (["abc"])));
observe("reduceRight: a string again", () => [0].reduceRight(readsCharCode14, ("abc")));

readsCharCode15("abc");
readsCharCode15("abc");
observe("Array.from of an array: a string", () => Array.from([("abc")], readsCharCode15));
observe("Array.from of an array: an object with charCodeAt", () => Array.from([(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))], readsCharCode15));
observe("Array.from of an array: an array", () => Array.from([(["abc"])], readsCharCode15));
observe("Array.from of an array: a string again", () => Array.from([("abc")], readsCharCode15));

readsCharCode16("abc");
readsCharCode16("abc");
observe("Array.from of an array-like: a string", () => Array.from({ length: 1, 0: ("abc") }, readsCharCode16));
observe("Array.from of an array-like: an object with charCodeAt", () => Array.from({ length: 1, 0: (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })) }, readsCharCode16));
observe("Array.from of an array-like: an array", () => Array.from({ length: 1, 0: (["abc"]) }, readsCharCode16));
observe("Array.from of an array-like: a string again", () => Array.from({ length: 1, 0: ("abc") }, readsCharCode16));

readsCharCode17("abc");
readsCharCode17("abc");
observe("Array.from of a set: a string", () => Array.from(new Set([("abc")]), readsCharCode17));
observe("Array.from of a set: an object with charCodeAt", () => Array.from(new Set([(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))]), readsCharCode17));
observe("Array.from of a set: an array", () => Array.from(new Set([(["abc"])]), readsCharCode17));
observe("Array.from of a set: a string again", () => Array.from(new Set([("abc")]), readsCharCode17));

readsCharCode18("abc");
readsCharCode18("abc");
observe("forEach of an array-like: a string", () => Array.prototype.forEach.call({ length: 1, 0: ("abc") }, readsCharCode18));
observe("forEach of an array-like: an object with charCodeAt", () => Array.prototype.forEach.call({ length: 1, 0: (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })) }, readsCharCode18));
observe("forEach of an array-like: an array", () => Array.prototype.forEach.call({ length: 1, 0: (["abc"]) }, readsCharCode18));
observe("forEach of an array-like: a string again", () => Array.prototype.forEach.call({ length: 1, 0: ("abc") }, readsCharCode18));

readsCharCode19("abc");
readsCharCode19("abc");
observe("forEach of a set: a string", () => new Set([("abc")]).forEach(readsCharCode19));
observe("forEach of a set: an object with charCodeAt", () => new Set([(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))]).forEach(readsCharCode19));
observe("forEach of a set: an array", () => new Set([(["abc"])]).forEach(readsCharCode19));
observe("forEach of a set: a string again", () => new Set([("abc")]).forEach(readsCharCode19));

readsCharCode20("abc");
readsCharCode20("abc");
observe("forEach of a map: a string", () => new Map([[0, ("abc")]]).forEach(readsCharCode20));
observe("forEach of a map: an object with charCodeAt", () => new Map([[0, (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))]]).forEach(readsCharCode20));
observe("forEach of a map: an array", () => new Map([[0, (["abc"])]]).forEach(readsCharCode20));
observe("forEach of a map: a string again", () => new Map([[0, ("abc")]]).forEach(readsCharCode20));

readsCharCode21("abc");
readsCharCode21("abc");
observe("map of an iterator: a string", () => [("abc")].values().map(readsCharCode21).toArray());
observe("map of an iterator: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].values().map(readsCharCode21).toArray());
observe("map of an iterator: an array", () => [(["abc"])].values().map(readsCharCode21).toArray());
observe("map of an iterator: a string again", () => [("abc")].values().map(readsCharCode21).toArray());

readsCharCode22("abc");
readsCharCode22("abc");
observe("forEach of an iterator: a string", () => [("abc")].values().forEach(readsCharCode22));
observe("forEach of an iterator: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].values().forEach(readsCharCode22));
observe("forEach of an iterator: an array", () => [(["abc"])].values().forEach(readsCharCode22));
observe("forEach of an iterator: a string again", () => [("abc")].values().forEach(readsCharCode22));

readsCharCode23("abc");
readsCharCode23("abc");
observe("reduce of an iterator: a string", () => [0].values().reduce(readsCharCode23, ("abc")));
observe("reduce of an iterator: an object with charCodeAt", () => [0].values().reduce(readsCharCode23, (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))));
observe("reduce of an iterator: an array", () => [0].values().reduce(readsCharCode23, (["abc"])));
observe("reduce of an iterator: a string again", () => [0].values().reduce(readsCharCode23, ("abc")));

readsCharCode24("abc");
readsCharCode24("abc");
observe("filter of an iterator: a string", () => [("abc")].values().filter(readsCharCode24).toArray());
observe("filter of an iterator: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].values().filter(readsCharCode24).toArray());
observe("filter of an iterator: an array", () => [(["abc"])].values().filter(readsCharCode24).toArray());
observe("filter of an iterator: a string again", () => [("abc")].values().filter(readsCharCode24).toArray());

readsCharCode25("abc");
readsCharCode25("abc");
observe("find of an iterator: a string", () => [("abc")].values().find(readsCharCode25));
observe("find of an iterator: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].values().find(readsCharCode25));
observe("find of an iterator: an array", () => [(["abc"])].values().find(readsCharCode25));
observe("find of an iterator: a string again", () => [("abc")].values().find(readsCharCode25));

readsCharCode26("abc");
readsCharCode26("abc");
observe("some of an iterator: a string", () => [("abc")].values().some(readsCharCode26));
observe("some of an iterator: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].values().some(readsCharCode26));
observe("some of an iterator: an array", () => [(["abc"])].values().some(readsCharCode26));
observe("some of an iterator: a string again", () => [("abc")].values().some(readsCharCode26));

readsCharCode27("abc");
readsCharCode27("abc");
observe("every of an iterator: a string", () => [("abc")].values().every(readsCharCode27));
observe("every of an iterator: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].values().every(readsCharCode27));
observe("every of an iterator: an array", () => [(["abc"])].values().every(readsCharCode27));
observe("every of an iterator: a string again", () => [("abc")].values().every(readsCharCode27));

readsCharCode28("abc");
readsCharCode28("abc");
observe("findLastIndex: a string", () => [("abc")].findLastIndex(readsCharCode28));
observe("findLastIndex: an object with charCodeAt", () => [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].findLastIndex(readsCharCode28));
observe("findLastIndex: an array", () => [(["abc"])].findLastIndex(readsCharCode28));
observe("findLastIndex: a string again", () => [("abc")].findLastIndex(readsCharCode28));

readsCharCode29("abc");
readsCharCode29("abc");
observe("a typed array made from a list: a string", () => Uint8Array.from([("abc")], readsCharCode29));
observe("a typed array made from a list: an object with charCodeAt", () => Uint8Array.from([(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))], readsCharCode29));
observe("a typed array made from a list: an array", () => Uint8Array.from([(["abc"])], readsCharCode29));
observe("a typed array made from a list: a string again", () => Uint8Array.from([("abc")], readsCharCode29));

readsCharCode30("abc");
readsCharCode30("abc");
observe("adopt of a disposable stack: a string", () => (stack => (stack.adopt(("abc"), readsCharCode30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an object with charCodeAt", () => (stack => (stack.adopt((({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })), readsCharCode30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an array", () => (stack => (stack.adopt((["abc"]), readsCharCode30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: a string again", () => (stack => (stack.adopt(("abc"), readsCharCode30), stack.dispose()))(new DisposableStack()));

readsCharCode31("abc");
readsCharCode31("abc");
observe("getOrInsertComputed of a map: a string", () => new Map().getOrInsertComputed(("abc"), readsCharCode31));
observe("getOrInsertComputed of a map: an object with charCodeAt", () => new Map().getOrInsertComputed((({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })), readsCharCode31));
observe("getOrInsertComputed of a map: an array", () => new Map().getOrInsertComputed((["abc"]), readsCharCode31));
observe("getOrInsertComputed of a map: a string again", () => new Map().getOrInsertComputed(("abc"), readsCharCode31));

readsCharCode32("abc");
readsCharCode32("abc");
observe("Object.groupBy: a string", () => Object.groupBy([("abc")], readsCharCode32));
observe("Object.groupBy: an object with charCodeAt", () => Object.groupBy([(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))], readsCharCode32));
observe("Object.groupBy: an array", () => Object.groupBy([(["abc"])], readsCharCode32));
observe("Object.groupBy: a string again", () => Object.groupBy([("abc")], readsCharCode32));

readsCharCode33("abc");
readsCharCode33("abc");
observe("Map.groupBy: a string", () => Map.groupBy([("abc")], readsCharCode33));
observe("Map.groupBy: an object with charCodeAt", () => Map.groupBy([(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))], readsCharCode33));
observe("Map.groupBy: an array", () => Map.groupBy([(["abc"])], readsCharCode33));
observe("Map.groupBy: a string again", () => Map.groupBy([("abc")], readsCharCode33));

readsCharCode34("abc");
readsCharCode34("abc");
observe("Reflect.apply: a string", () => Reflect.apply(readsCharCode34, undefined, [("abc")]));
observe("Reflect.apply: an object with charCodeAt", () => Reflect.apply(readsCharCode34, undefined, [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))]));
observe("Reflect.apply: an array", () => Reflect.apply(readsCharCode34, undefined, [(["abc"])]));
observe("Reflect.apply: a string again", () => Reflect.apply(readsCharCode34, undefined, [("abc")]));

readsCharCode35("abc");
readsCharCode35("abc");
observe("Reflect.apply with an array-like: a string", () => Reflect.apply(readsCharCode35, undefined, { length: 1, 0: ("abc") }));
observe("Reflect.apply with an array-like: an object with charCodeAt", () => Reflect.apply(readsCharCode35, undefined, { length: 1, 0: (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })) }));
observe("Reflect.apply with an array-like: an array", () => Reflect.apply(readsCharCode35, undefined, { length: 1, 0: (["abc"]) }));
observe("Reflect.apply with an array-like: a string again", () => Reflect.apply(readsCharCode35, undefined, { length: 1, 0: ("abc") }));

readsCharCode36("abc");
readsCharCode36("abc");
observe("Reflect.construct: a string", () => Reflect.construct(readsCharCode36, [("abc")]));
observe("Reflect.construct: an object with charCodeAt", () => Reflect.construct(readsCharCode36, [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))]));
observe("Reflect.construct: an array", () => Reflect.construct(readsCharCode36, [(["abc"])]));
observe("Reflect.construct: a string again", () => Reflect.construct(readsCharCode36, [("abc")]));

readsCharCode37("abc");
readsCharCode37("abc");
observe("call: a string", () => readsCharCode37.call(undefined, ("abc")));
observe("call: an object with charCodeAt", () => readsCharCode37.call(undefined, (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))));
observe("call: an array", () => readsCharCode37.call(undefined, (["abc"])));
observe("call: a string again", () => readsCharCode37.call(undefined, ("abc")));

readsCharCode38("abc");
readsCharCode38("abc");
observe("apply: a string", () => readsCharCode38.apply(undefined, [("abc")]));
observe("apply: an object with charCodeAt", () => readsCharCode38.apply(undefined, [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))]));
observe("apply: an array", () => readsCharCode38.apply(undefined, [(["abc"])]));
observe("apply: a string again", () => readsCharCode38.apply(undefined, [("abc")]));

readsCharCode39("abc");
readsCharCode39("abc");
observe("bind: a string", () => readsCharCode39.bind(undefined, ("abc"))());
observe("bind: an object with charCodeAt", () => readsCharCode39.bind(undefined, (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })))());
observe("bind: an array", () => readsCharCode39.bind(undefined, (["abc"]))());
observe("bind: a string again", () => readsCharCode39.bind(undefined, ("abc"))());

readsCharCode40("abc");
readsCharCode40("abc");
observe("a setter: a string", () => Object.defineProperty({}, "key", { set: readsCharCode40 }).key = ("abc"));
observe("a setter: an object with charCodeAt", () => Object.defineProperty({}, "key", { set: readsCharCode40 }).key = (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })));
observe("a setter: an array", () => Object.defineProperty({}, "key", { set: readsCharCode40 }).key = (["abc"]));
observe("a setter: a string again", () => Object.defineProperty({}, "key", { set: readsCharCode40 }).key = ("abc"));

readsCharCode41("abc");
readsCharCode41("abc");
observe("Symbol.hasInstance: a string", () => ("abc") instanceof { [Symbol.hasInstance]: readsCharCode41 });
observe("Symbol.hasInstance: an object with charCodeAt", () => (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })) instanceof { [Symbol.hasInstance]: readsCharCode41 });
observe("Symbol.hasInstance: an array", () => (["abc"]) instanceof { [Symbol.hasInstance]: readsCharCode41 });
observe("Symbol.hasInstance: a string again", () => ("abc") instanceof { [Symbol.hasInstance]: readsCharCode41 });

readsCharCode42("abc");
readsCharCode42("abc");
observe("the set trap of a proxy: a string", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(readsCharCode42, undefined, [value]), true) }).key = ("abc"));
observe("the set trap of a proxy: an object with charCodeAt", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(readsCharCode42, undefined, [value]), true) }).key = (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })));
observe("the set trap of a proxy: an array", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(readsCharCode42, undefined, [value]), true) }).key = (["abc"]));
observe("the set trap of a proxy: a string again", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(readsCharCode42, undefined, [value]), true) }).key = ("abc"));

readsCharCode43("abc");
readsCharCode43("abc");
observe("a replacer of JSON.stringify: a string", () => JSON.stringify(0, () => void [("abc")].forEach(readsCharCode43)));
observe("a replacer of JSON.stringify: an object with charCodeAt", () => JSON.stringify(0, () => void [(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))].forEach(readsCharCode43)));
observe("a replacer of JSON.stringify: an array", () => JSON.stringify(0, () => void [(["abc"])].forEach(readsCharCode43)));
observe("a replacer of JSON.stringify: a string again", () => JSON.stringify(0, () => void [("abc")].forEach(readsCharCode43)));

readsCharCode44(0, "abc");
readsCharCode44(0, "abc");
observe("a tagged template: a string", () => readsCharCode44.bind(undefined)`${("abc")}`);
observe("a tagged template: an object with charCodeAt", () => readsCharCode44.bind(undefined)`${(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))}`);
observe("a tagged template: an array", () => readsCharCode44.bind(undefined)`${(["abc"])}`);
observe("a tagged template: a string again", () => readsCharCode44.bind(undefined)`${("abc")}`);

readsCharCode45(0, "abc");
readsCharCode45(0, "abc");
observe("a replacer of JSON.stringify, second parameter: a string", () => JSON.stringify(("abc"), readsCharCode45));
observe("a replacer of JSON.stringify, second parameter: an object with charCodeAt", () => JSON.stringify((({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })), readsCharCode45));
observe("a replacer of JSON.stringify, second parameter: an array", () => JSON.stringify((["abc"]), readsCharCode45));
observe("a replacer of JSON.stringify, second parameter: a string again", () => JSON.stringify(("abc"), readsCharCode45));

readsCharCode46("abc");
readsCharCode46("abc");
observe("a listener of an event emitter: a string", () => new (require("node:events").EventEmitter)().once("value", readsCharCode46).emit("value", ("abc")));
observe("a listener of an event emitter: an object with charCodeAt", () => new (require("node:events").EventEmitter)().once("value", readsCharCode46).emit("value", (({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } }))));
observe("a listener of an event emitter: an array", () => new (require("node:events").EventEmitter)().once("value", readsCharCode46).emit("value", (["abc"])));
observe("a listener of an event emitter: a string again", () => new (require("node:events").EventEmitter)().once("value", readsCharCode46).emit("value", ("abc")));
