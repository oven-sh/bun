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

function addsMembers1(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers2(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers3(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers4(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers5(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers6(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers7(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers8(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers9(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers10(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers11(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers12(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers13(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers14(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers15(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers16(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers17(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers18(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers19(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers20(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers21(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers22(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers23(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers24(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers25(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers26(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers27(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers28(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers29(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers30(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers31(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers32(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers33(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers34(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers35(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers36(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers37(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers38(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers39(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers40(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers41(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers42(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers43(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers44(ignored, o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers45(ignored, o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers46(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

console.log("strict:", (function () { return this === undefined; })());

addsMembers1(({ x: 1, y: 2 }));
addsMembers1(({ x: 1, y: 2 }));
observe("forEach: an object", () => [(({ x: 1, y: 2 }))].forEach(addsMembers1));
observe("forEach: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].forEach(addsMembers1));
observe("forEach: a proxy", () => [(logged({ y: 2, x: 1 }))].forEach(addsMembers1));
observe("forEach: an object again", () => [(({ x: 1, y: 2 }))].forEach(addsMembers1));

addsMembers2(({ x: 1, y: 2 }));
addsMembers2(({ x: 1, y: 2 }));
observe("map: an object", () => [(({ x: 1, y: 2 }))].map(addsMembers2));
observe("map: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].map(addsMembers2));
observe("map: a proxy", () => [(logged({ y: 2, x: 1 }))].map(addsMembers2));
observe("map: an object again", () => [(({ x: 1, y: 2 }))].map(addsMembers2));

addsMembers3(({ x: 1, y: 2 }));
addsMembers3(({ x: 1, y: 2 }));
observe("filter: an object", () => [(({ x: 1, y: 2 }))].filter(addsMembers3));
observe("filter: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].filter(addsMembers3));
observe("filter: a proxy", () => [(logged({ y: 2, x: 1 }))].filter(addsMembers3));
observe("filter: an object again", () => [(({ x: 1, y: 2 }))].filter(addsMembers3));

addsMembers4(({ x: 1, y: 2 }));
addsMembers4(({ x: 1, y: 2 }));
observe("some: an object", () => [(({ x: 1, y: 2 }))].some(addsMembers4));
observe("some: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].some(addsMembers4));
observe("some: a proxy", () => [(logged({ y: 2, x: 1 }))].some(addsMembers4));
observe("some: an object again", () => [(({ x: 1, y: 2 }))].some(addsMembers4));

addsMembers5(({ x: 1, y: 2 }));
addsMembers5(({ x: 1, y: 2 }));
observe("every: an object", () => [(({ x: 1, y: 2 }))].every(addsMembers5));
observe("every: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].every(addsMembers5));
observe("every: a proxy", () => [(logged({ y: 2, x: 1 }))].every(addsMembers5));
observe("every: an object again", () => [(({ x: 1, y: 2 }))].every(addsMembers5));

addsMembers6(({ x: 1, y: 2 }));
addsMembers6(({ x: 1, y: 2 }));
observe("find: an object", () => [(({ x: 1, y: 2 }))].find(addsMembers6));
observe("find: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].find(addsMembers6));
observe("find: a proxy", () => [(logged({ y: 2, x: 1 }))].find(addsMembers6));
observe("find: an object again", () => [(({ x: 1, y: 2 }))].find(addsMembers6));

addsMembers7(({ x: 1, y: 2 }));
addsMembers7(({ x: 1, y: 2 }));
observe("findIndex: an object", () => [(({ x: 1, y: 2 }))].findIndex(addsMembers7));
observe("findIndex: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].findIndex(addsMembers7));
observe("findIndex: a proxy", () => [(logged({ y: 2, x: 1 }))].findIndex(addsMembers7));
observe("findIndex: an object again", () => [(({ x: 1, y: 2 }))].findIndex(addsMembers7));

addsMembers8(({ x: 1, y: 2 }));
addsMembers8(({ x: 1, y: 2 }));
observe("findLast: an object", () => [(({ x: 1, y: 2 }))].findLast(addsMembers8));
observe("findLast: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].findLast(addsMembers8));
observe("findLast: a proxy", () => [(logged({ y: 2, x: 1 }))].findLast(addsMembers8));
observe("findLast: an object again", () => [(({ x: 1, y: 2 }))].findLast(addsMembers8));

addsMembers9(({ x: 1, y: 2 }));
addsMembers9(({ x: 1, y: 2 }));
observe("flatMap: an object", () => [(({ x: 1, y: 2 }))].flatMap(addsMembers9));
observe("flatMap: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].flatMap(addsMembers9));
observe("flatMap: a proxy", () => [(logged({ y: 2, x: 1 }))].flatMap(addsMembers9));
observe("flatMap: an object again", () => [(({ x: 1, y: 2 }))].flatMap(addsMembers9));

addsMembers10(({ x: 1, y: 2 }));
addsMembers10(({ x: 1, y: 2 }));
observe("sort: an object", () => [(({ x: 1, y: 2 })), (({ x: 1, y: 2 }))].sort(addsMembers10));
observe("sort: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].sort(addsMembers10));
observe("sort: a proxy", () => [(logged({ y: 2, x: 1 })), (logged({ y: 2, x: 1 }))].sort(addsMembers10));
observe("sort: an object again", () => [(({ x: 1, y: 2 })), (({ x: 1, y: 2 }))].sort(addsMembers10));

addsMembers11(({ x: 1, y: 2 }));
addsMembers11(({ x: 1, y: 2 }));
observe("toSorted: an object", () => [(({ x: 1, y: 2 })), (({ x: 1, y: 2 }))].toSorted(addsMembers11));
observe("toSorted: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].toSorted(addsMembers11));
observe("toSorted: a proxy", () => [(logged({ y: 2, x: 1 })), (logged({ y: 2, x: 1 }))].toSorted(addsMembers11));
observe("toSorted: an object again", () => [(({ x: 1, y: 2 })), (({ x: 1, y: 2 }))].toSorted(addsMembers11));

addsMembers12(({ x: 1, y: 2 }));
addsMembers12(({ x: 1, y: 2 }));
observe("reduce with a first value: an object", () => [0].reduce(addsMembers12, (({ x: 1, y: 2 }))));
observe("reduce with a first value: accessors", () => [0].reduce(addsMembers12, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))));
observe("reduce with a first value: a proxy", () => [0].reduce(addsMembers12, (logged({ y: 2, x: 1 }))));
observe("reduce with a first value: an object again", () => [0].reduce(addsMembers12, (({ x: 1, y: 2 }))));

addsMembers13(({ x: 1, y: 2 }));
addsMembers13(({ x: 1, y: 2 }));
observe("reduce without a first value: an object", () => [(({ x: 1, y: 2 })), 0].reduce(addsMembers13));
observe("reduce without a first value: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), 0].reduce(addsMembers13));
observe("reduce without a first value: a proxy", () => [(logged({ y: 2, x: 1 })), 0].reduce(addsMembers13));
observe("reduce without a first value: an object again", () => [(({ x: 1, y: 2 })), 0].reduce(addsMembers13));

addsMembers14(({ x: 1, y: 2 }));
addsMembers14(({ x: 1, y: 2 }));
observe("reduceRight: an object", () => [0].reduceRight(addsMembers14, (({ x: 1, y: 2 }))));
observe("reduceRight: accessors", () => [0].reduceRight(addsMembers14, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))));
observe("reduceRight: a proxy", () => [0].reduceRight(addsMembers14, (logged({ y: 2, x: 1 }))));
observe("reduceRight: an object again", () => [0].reduceRight(addsMembers14, (({ x: 1, y: 2 }))));

addsMembers15(({ x: 1, y: 2 }));
addsMembers15(({ x: 1, y: 2 }));
observe("Array.from of an array: an object", () => Array.from([(({ x: 1, y: 2 }))], addsMembers15));
observe("Array.from of an array: accessors", () => Array.from([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))], addsMembers15));
observe("Array.from of an array: a proxy", () => Array.from([(logged({ y: 2, x: 1 }))], addsMembers15));
observe("Array.from of an array: an object again", () => Array.from([(({ x: 1, y: 2 }))], addsMembers15));

addsMembers16(({ x: 1, y: 2 }));
addsMembers16(({ x: 1, y: 2 }));
observe("Array.from of an array-like: an object", () => Array.from({ length: 1, 0: (({ x: 1, y: 2 })) }, addsMembers16));
observe("Array.from of an array-like: accessors", () => Array.from({ length: 1, 0: (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })) }, addsMembers16));
observe("Array.from of an array-like: a proxy", () => Array.from({ length: 1, 0: (logged({ y: 2, x: 1 })) }, addsMembers16));
observe("Array.from of an array-like: an object again", () => Array.from({ length: 1, 0: (({ x: 1, y: 2 })) }, addsMembers16));

addsMembers17(({ x: 1, y: 2 }));
addsMembers17(({ x: 1, y: 2 }));
observe("Array.from of a set: an object", () => Array.from(new Set([(({ x: 1, y: 2 }))]), addsMembers17));
observe("Array.from of a set: accessors", () => Array.from(new Set([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]), addsMembers17));
observe("Array.from of a set: a proxy", () => Array.from(new Set([(logged({ y: 2, x: 1 }))]), addsMembers17));
observe("Array.from of a set: an object again", () => Array.from(new Set([(({ x: 1, y: 2 }))]), addsMembers17));

addsMembers18(({ x: 1, y: 2 }));
addsMembers18(({ x: 1, y: 2 }));
observe("forEach of an array-like: an object", () => Array.prototype.forEach.call({ length: 1, 0: (({ x: 1, y: 2 })) }, addsMembers18));
observe("forEach of an array-like: accessors", () => Array.prototype.forEach.call({ length: 1, 0: (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })) }, addsMembers18));
observe("forEach of an array-like: a proxy", () => Array.prototype.forEach.call({ length: 1, 0: (logged({ y: 2, x: 1 })) }, addsMembers18));
observe("forEach of an array-like: an object again", () => Array.prototype.forEach.call({ length: 1, 0: (({ x: 1, y: 2 })) }, addsMembers18));

addsMembers19(({ x: 1, y: 2 }));
addsMembers19(({ x: 1, y: 2 }));
observe("forEach of a set: an object", () => new Set([(({ x: 1, y: 2 }))]).forEach(addsMembers19));
observe("forEach of a set: accessors", () => new Set([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]).forEach(addsMembers19));
observe("forEach of a set: a proxy", () => new Set([(logged({ y: 2, x: 1 }))]).forEach(addsMembers19));
observe("forEach of a set: an object again", () => new Set([(({ x: 1, y: 2 }))]).forEach(addsMembers19));

addsMembers20(({ x: 1, y: 2 }));
addsMembers20(({ x: 1, y: 2 }));
observe("forEach of a map: an object", () => new Map([[0, (({ x: 1, y: 2 }))]]).forEach(addsMembers20));
observe("forEach of a map: accessors", () => new Map([[0, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]]).forEach(addsMembers20));
observe("forEach of a map: a proxy", () => new Map([[0, (logged({ y: 2, x: 1 }))]]).forEach(addsMembers20));
observe("forEach of a map: an object again", () => new Map([[0, (({ x: 1, y: 2 }))]]).forEach(addsMembers20));

addsMembers21(({ x: 1, y: 2 }));
addsMembers21(({ x: 1, y: 2 }));
observe("map of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().map(addsMembers21).toArray());
observe("map of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().map(addsMembers21).toArray());
observe("map of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().map(addsMembers21).toArray());
observe("map of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().map(addsMembers21).toArray());

addsMembers22(({ x: 1, y: 2 }));
addsMembers22(({ x: 1, y: 2 }));
observe("forEach of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().forEach(addsMembers22));
observe("forEach of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().forEach(addsMembers22));
observe("forEach of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().forEach(addsMembers22));
observe("forEach of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().forEach(addsMembers22));

addsMembers23(({ x: 1, y: 2 }));
addsMembers23(({ x: 1, y: 2 }));
observe("reduce of an iterator: an object", () => [0].values().reduce(addsMembers23, (({ x: 1, y: 2 }))));
observe("reduce of an iterator: accessors", () => [0].values().reduce(addsMembers23, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))));
observe("reduce of an iterator: a proxy", () => [0].values().reduce(addsMembers23, (logged({ y: 2, x: 1 }))));
observe("reduce of an iterator: an object again", () => [0].values().reduce(addsMembers23, (({ x: 1, y: 2 }))));

addsMembers24(({ x: 1, y: 2 }));
addsMembers24(({ x: 1, y: 2 }));
observe("filter of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().filter(addsMembers24).toArray());
observe("filter of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().filter(addsMembers24).toArray());
observe("filter of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().filter(addsMembers24).toArray());
observe("filter of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().filter(addsMembers24).toArray());

addsMembers25(({ x: 1, y: 2 }));
addsMembers25(({ x: 1, y: 2 }));
observe("find of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().find(addsMembers25));
observe("find of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().find(addsMembers25));
observe("find of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().find(addsMembers25));
observe("find of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().find(addsMembers25));

addsMembers26(({ x: 1, y: 2 }));
addsMembers26(({ x: 1, y: 2 }));
observe("some of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().some(addsMembers26));
observe("some of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().some(addsMembers26));
observe("some of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().some(addsMembers26));
observe("some of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().some(addsMembers26));

addsMembers27(({ x: 1, y: 2 }));
addsMembers27(({ x: 1, y: 2 }));
observe("every of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().every(addsMembers27));
observe("every of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().every(addsMembers27));
observe("every of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().every(addsMembers27));
observe("every of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().every(addsMembers27));

addsMembers28(({ x: 1, y: 2 }));
addsMembers28(({ x: 1, y: 2 }));
observe("findLastIndex: an object", () => [(({ x: 1, y: 2 }))].findLastIndex(addsMembers28));
observe("findLastIndex: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].findLastIndex(addsMembers28));
observe("findLastIndex: a proxy", () => [(logged({ y: 2, x: 1 }))].findLastIndex(addsMembers28));
observe("findLastIndex: an object again", () => [(({ x: 1, y: 2 }))].findLastIndex(addsMembers28));

addsMembers29(({ x: 1, y: 2 }));
addsMembers29(({ x: 1, y: 2 }));
observe("a typed array made from a list: an object", () => Uint8Array.from([(({ x: 1, y: 2 }))], addsMembers29));
observe("a typed array made from a list: accessors", () => Uint8Array.from([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))], addsMembers29));
observe("a typed array made from a list: a proxy", () => Uint8Array.from([(logged({ y: 2, x: 1 }))], addsMembers29));
observe("a typed array made from a list: an object again", () => Uint8Array.from([(({ x: 1, y: 2 }))], addsMembers29));

addsMembers30(({ x: 1, y: 2 }));
addsMembers30(({ x: 1, y: 2 }));
observe("adopt of a disposable stack: an object", () => (stack => (stack.adopt((({ x: 1, y: 2 })), addsMembers30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: accessors", () => (stack => (stack.adopt((({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), addsMembers30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: a proxy", () => (stack => (stack.adopt((logged({ y: 2, x: 1 })), addsMembers30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an object again", () => (stack => (stack.adopt((({ x: 1, y: 2 })), addsMembers30), stack.dispose()))(new DisposableStack()));

addsMembers31(({ x: 1, y: 2 }));
addsMembers31(({ x: 1, y: 2 }));
observe("getOrInsertComputed of a map: an object", () => new Map().getOrInsertComputed((({ x: 1, y: 2 })), addsMembers31));
observe("getOrInsertComputed of a map: accessors", () => new Map().getOrInsertComputed((({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), addsMembers31));
observe("getOrInsertComputed of a map: a proxy", () => new Map().getOrInsertComputed((logged({ y: 2, x: 1 })), addsMembers31));
observe("getOrInsertComputed of a map: an object again", () => new Map().getOrInsertComputed((({ x: 1, y: 2 })), addsMembers31));

addsMembers32(({ x: 1, y: 2 }));
addsMembers32(({ x: 1, y: 2 }));
observe("Object.groupBy: an object", () => Object.groupBy([(({ x: 1, y: 2 }))], addsMembers32));
observe("Object.groupBy: accessors", () => Object.groupBy([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))], addsMembers32));
observe("Object.groupBy: a proxy", () => Object.groupBy([(logged({ y: 2, x: 1 }))], addsMembers32));
observe("Object.groupBy: an object again", () => Object.groupBy([(({ x: 1, y: 2 }))], addsMembers32));

addsMembers33(({ x: 1, y: 2 }));
addsMembers33(({ x: 1, y: 2 }));
observe("Map.groupBy: an object", () => Map.groupBy([(({ x: 1, y: 2 }))], addsMembers33));
observe("Map.groupBy: accessors", () => Map.groupBy([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))], addsMembers33));
observe("Map.groupBy: a proxy", () => Map.groupBy([(logged({ y: 2, x: 1 }))], addsMembers33));
observe("Map.groupBy: an object again", () => Map.groupBy([(({ x: 1, y: 2 }))], addsMembers33));

addsMembers34(({ x: 1, y: 2 }));
addsMembers34(({ x: 1, y: 2 }));
observe("Reflect.apply: an object", () => Reflect.apply(addsMembers34, undefined, [(({ x: 1, y: 2 }))]));
observe("Reflect.apply: accessors", () => Reflect.apply(addsMembers34, undefined, [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]));
observe("Reflect.apply: a proxy", () => Reflect.apply(addsMembers34, undefined, [(logged({ y: 2, x: 1 }))]));
observe("Reflect.apply: an object again", () => Reflect.apply(addsMembers34, undefined, [(({ x: 1, y: 2 }))]));

addsMembers35(({ x: 1, y: 2 }));
addsMembers35(({ x: 1, y: 2 }));
observe("Reflect.apply with an array-like: an object", () => Reflect.apply(addsMembers35, undefined, { length: 1, 0: (({ x: 1, y: 2 })) }));
observe("Reflect.apply with an array-like: accessors", () => Reflect.apply(addsMembers35, undefined, { length: 1, 0: (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })) }));
observe("Reflect.apply with an array-like: a proxy", () => Reflect.apply(addsMembers35, undefined, { length: 1, 0: (logged({ y: 2, x: 1 })) }));
observe("Reflect.apply with an array-like: an object again", () => Reflect.apply(addsMembers35, undefined, { length: 1, 0: (({ x: 1, y: 2 })) }));

addsMembers36(({ x: 1, y: 2 }));
addsMembers36(({ x: 1, y: 2 }));
observe("Reflect.construct: an object", () => Reflect.construct(addsMembers36, [(({ x: 1, y: 2 }))]));
observe("Reflect.construct: accessors", () => Reflect.construct(addsMembers36, [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]));
observe("Reflect.construct: a proxy", () => Reflect.construct(addsMembers36, [(logged({ y: 2, x: 1 }))]));
observe("Reflect.construct: an object again", () => Reflect.construct(addsMembers36, [(({ x: 1, y: 2 }))]));

addsMembers37(({ x: 1, y: 2 }));
addsMembers37(({ x: 1, y: 2 }));
observe("call: an object", () => addsMembers37.call(undefined, (({ x: 1, y: 2 }))));
observe("call: accessors", () => addsMembers37.call(undefined, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))));
observe("call: a proxy", () => addsMembers37.call(undefined, (logged({ y: 2, x: 1 }))));
observe("call: an object again", () => addsMembers37.call(undefined, (({ x: 1, y: 2 }))));

addsMembers38(({ x: 1, y: 2 }));
addsMembers38(({ x: 1, y: 2 }));
observe("apply: an object", () => addsMembers38.apply(undefined, [(({ x: 1, y: 2 }))]));
observe("apply: accessors", () => addsMembers38.apply(undefined, [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]));
observe("apply: a proxy", () => addsMembers38.apply(undefined, [(logged({ y: 2, x: 1 }))]));
observe("apply: an object again", () => addsMembers38.apply(undefined, [(({ x: 1, y: 2 }))]));

addsMembers39(({ x: 1, y: 2 }));
addsMembers39(({ x: 1, y: 2 }));
observe("bind: an object", () => addsMembers39.bind(undefined, (({ x: 1, y: 2 })))());
observe("bind: accessors", () => addsMembers39.bind(undefined, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })))());
observe("bind: a proxy", () => addsMembers39.bind(undefined, (logged({ y: 2, x: 1 })))());
observe("bind: an object again", () => addsMembers39.bind(undefined, (({ x: 1, y: 2 })))());

addsMembers40(({ x: 1, y: 2 }));
addsMembers40(({ x: 1, y: 2 }));
observe("a setter: an object", () => Object.defineProperty({}, "key", { set: addsMembers40 }).key = (({ x: 1, y: 2 })));
observe("a setter: accessors", () => Object.defineProperty({}, "key", { set: addsMembers40 }).key = (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })));
observe("a setter: a proxy", () => Object.defineProperty({}, "key", { set: addsMembers40 }).key = (logged({ y: 2, x: 1 })));
observe("a setter: an object again", () => Object.defineProperty({}, "key", { set: addsMembers40 }).key = (({ x: 1, y: 2 })));

addsMembers41(({ x: 1, y: 2 }));
addsMembers41(({ x: 1, y: 2 }));
observe("Symbol.hasInstance: an object", () => (({ x: 1, y: 2 })) instanceof { [Symbol.hasInstance]: addsMembers41 });
observe("Symbol.hasInstance: accessors", () => (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })) instanceof { [Symbol.hasInstance]: addsMembers41 });
observe("Symbol.hasInstance: a proxy", () => (logged({ y: 2, x: 1 })) instanceof { [Symbol.hasInstance]: addsMembers41 });
observe("Symbol.hasInstance: an object again", () => (({ x: 1, y: 2 })) instanceof { [Symbol.hasInstance]: addsMembers41 });

addsMembers42(({ x: 1, y: 2 }));
addsMembers42(({ x: 1, y: 2 }));
observe("the set trap of a proxy: an object", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(addsMembers42, undefined, [value]), true) }).key = (({ x: 1, y: 2 })));
observe("the set trap of a proxy: accessors", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(addsMembers42, undefined, [value]), true) }).key = (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })));
observe("the set trap of a proxy: a proxy", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(addsMembers42, undefined, [value]), true) }).key = (logged({ y: 2, x: 1 })));
observe("the set trap of a proxy: an object again", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(addsMembers42, undefined, [value]), true) }).key = (({ x: 1, y: 2 })));

addsMembers43(({ x: 1, y: 2 }));
addsMembers43(({ x: 1, y: 2 }));
observe("a replacer of JSON.stringify: an object", () => JSON.stringify(0, () => void [(({ x: 1, y: 2 }))].forEach(addsMembers43)));
observe("a replacer of JSON.stringify: accessors", () => JSON.stringify(0, () => void [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].forEach(addsMembers43)));
observe("a replacer of JSON.stringify: a proxy", () => JSON.stringify(0, () => void [(logged({ y: 2, x: 1 }))].forEach(addsMembers43)));
observe("a replacer of JSON.stringify: an object again", () => JSON.stringify(0, () => void [(({ x: 1, y: 2 }))].forEach(addsMembers43)));

addsMembers44(0, ({ x: 1, y: 2 }));
addsMembers44(0, ({ x: 1, y: 2 }));
observe("a tagged template: an object", () => addsMembers44.bind(undefined)`${(({ x: 1, y: 2 }))}`);
observe("a tagged template: accessors", () => addsMembers44.bind(undefined)`${(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))}`);
observe("a tagged template: a proxy", () => addsMembers44.bind(undefined)`${(logged({ y: 2, x: 1 }))}`);
observe("a tagged template: an object again", () => addsMembers44.bind(undefined)`${(({ x: 1, y: 2 }))}`);

addsMembers45(0, ({ x: 1, y: 2 }));
addsMembers45(0, ({ x: 1, y: 2 }));
observe("a replacer of JSON.stringify, second parameter: an object", () => JSON.stringify((({ x: 1, y: 2 })), addsMembers45));
observe("a replacer of JSON.stringify, second parameter: accessors", () => JSON.stringify((({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), addsMembers45));
observe("a replacer of JSON.stringify, second parameter: a proxy", () => JSON.stringify((logged({ y: 2, x: 1 })), addsMembers45));
observe("a replacer of JSON.stringify, second parameter: an object again", () => JSON.stringify((({ x: 1, y: 2 })), addsMembers45));

addsMembers46(({ x: 1, y: 2 }));
addsMembers46(({ x: 1, y: 2 }));
observe("a listener of an event emitter: an object", () => new (require("node:events").EventEmitter)().once("value", addsMembers46).emit("value", (({ x: 1, y: 2 }))));
observe("a listener of an event emitter: accessors", () => new (require("node:events").EventEmitter)().once("value", addsMembers46).emit("value", (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))));
observe("a listener of an event emitter: a proxy", () => new (require("node:events").EventEmitter)().once("value", addsMembers46).emit("value", (logged({ y: 2, x: 1 }))));
observe("a listener of an event emitter: an object again", () => new (require("node:events").EventEmitter)().once("value", addsMembers46).emit("value", (({ x: 1, y: 2 }))));
