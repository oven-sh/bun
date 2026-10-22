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

function storesMember1(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember2(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember3(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember4(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember5(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember6(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember7(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember8(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember9(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember10(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember11(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember12(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember13(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember14(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember15(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember16(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember17(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember18(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember19(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember20(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember21(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember22(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember23(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember24(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember25(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember26(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember27(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember28(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember29(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember30(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember31(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember32(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember33(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember34(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember35(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember36(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember37(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember38(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember39(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember40(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember41(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember42(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember43(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember44(ignored, o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember45(ignored, o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

function storesMember46(o) {
  o.x = 1;
  const result = o;
  results.push(result);
  return result;
}

console.log("strict:", (function () { return this === undefined; })());

storesMember1(({ x: 1, y: 2 }));
storesMember1(({ x: 1, y: 2 }));
observe("forEach: an object", () => [(({ x: 1, y: 2 }))].forEach(storesMember1));
observe("forEach: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].forEach(storesMember1));
observe("forEach: a proxy", () => [(logged({ y: 2, x: 1 }))].forEach(storesMember1));
observe("forEach: an object again", () => [(({ x: 1, y: 2 }))].forEach(storesMember1));

storesMember2(({ x: 1, y: 2 }));
storesMember2(({ x: 1, y: 2 }));
observe("map: an object", () => [(({ x: 1, y: 2 }))].map(storesMember2));
observe("map: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].map(storesMember2));
observe("map: a proxy", () => [(logged({ y: 2, x: 1 }))].map(storesMember2));
observe("map: an object again", () => [(({ x: 1, y: 2 }))].map(storesMember2));

storesMember3(({ x: 1, y: 2 }));
storesMember3(({ x: 1, y: 2 }));
observe("filter: an object", () => [(({ x: 1, y: 2 }))].filter(storesMember3));
observe("filter: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].filter(storesMember3));
observe("filter: a proxy", () => [(logged({ y: 2, x: 1 }))].filter(storesMember3));
observe("filter: an object again", () => [(({ x: 1, y: 2 }))].filter(storesMember3));

storesMember4(({ x: 1, y: 2 }));
storesMember4(({ x: 1, y: 2 }));
observe("some: an object", () => [(({ x: 1, y: 2 }))].some(storesMember4));
observe("some: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].some(storesMember4));
observe("some: a proxy", () => [(logged({ y: 2, x: 1 }))].some(storesMember4));
observe("some: an object again", () => [(({ x: 1, y: 2 }))].some(storesMember4));

storesMember5(({ x: 1, y: 2 }));
storesMember5(({ x: 1, y: 2 }));
observe("every: an object", () => [(({ x: 1, y: 2 }))].every(storesMember5));
observe("every: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].every(storesMember5));
observe("every: a proxy", () => [(logged({ y: 2, x: 1 }))].every(storesMember5));
observe("every: an object again", () => [(({ x: 1, y: 2 }))].every(storesMember5));

storesMember6(({ x: 1, y: 2 }));
storesMember6(({ x: 1, y: 2 }));
observe("find: an object", () => [(({ x: 1, y: 2 }))].find(storesMember6));
observe("find: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].find(storesMember6));
observe("find: a proxy", () => [(logged({ y: 2, x: 1 }))].find(storesMember6));
observe("find: an object again", () => [(({ x: 1, y: 2 }))].find(storesMember6));

storesMember7(({ x: 1, y: 2 }));
storesMember7(({ x: 1, y: 2 }));
observe("findIndex: an object", () => [(({ x: 1, y: 2 }))].findIndex(storesMember7));
observe("findIndex: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].findIndex(storesMember7));
observe("findIndex: a proxy", () => [(logged({ y: 2, x: 1 }))].findIndex(storesMember7));
observe("findIndex: an object again", () => [(({ x: 1, y: 2 }))].findIndex(storesMember7));

storesMember8(({ x: 1, y: 2 }));
storesMember8(({ x: 1, y: 2 }));
observe("findLast: an object", () => [(({ x: 1, y: 2 }))].findLast(storesMember8));
observe("findLast: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].findLast(storesMember8));
observe("findLast: a proxy", () => [(logged({ y: 2, x: 1 }))].findLast(storesMember8));
observe("findLast: an object again", () => [(({ x: 1, y: 2 }))].findLast(storesMember8));

storesMember9(({ x: 1, y: 2 }));
storesMember9(({ x: 1, y: 2 }));
observe("flatMap: an object", () => [(({ x: 1, y: 2 }))].flatMap(storesMember9));
observe("flatMap: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].flatMap(storesMember9));
observe("flatMap: a proxy", () => [(logged({ y: 2, x: 1 }))].flatMap(storesMember9));
observe("flatMap: an object again", () => [(({ x: 1, y: 2 }))].flatMap(storesMember9));

storesMember10(({ x: 1, y: 2 }));
storesMember10(({ x: 1, y: 2 }));
observe("sort: an object", () => [(({ x: 1, y: 2 })), (({ x: 1, y: 2 }))].sort(storesMember10));
observe("sort: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].sort(storesMember10));
observe("sort: a proxy", () => [(logged({ y: 2, x: 1 })), (logged({ y: 2, x: 1 }))].sort(storesMember10));
observe("sort: an object again", () => [(({ x: 1, y: 2 })), (({ x: 1, y: 2 }))].sort(storesMember10));

storesMember11(({ x: 1, y: 2 }));
storesMember11(({ x: 1, y: 2 }));
observe("toSorted: an object", () => [(({ x: 1, y: 2 })), (({ x: 1, y: 2 }))].toSorted(storesMember11));
observe("toSorted: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].toSorted(storesMember11));
observe("toSorted: a proxy", () => [(logged({ y: 2, x: 1 })), (logged({ y: 2, x: 1 }))].toSorted(storesMember11));
observe("toSorted: an object again", () => [(({ x: 1, y: 2 })), (({ x: 1, y: 2 }))].toSorted(storesMember11));

storesMember12(({ x: 1, y: 2 }));
storesMember12(({ x: 1, y: 2 }));
observe("reduce with a first value: an object", () => [0].reduce(storesMember12, (({ x: 1, y: 2 }))));
observe("reduce with a first value: accessors", () => [0].reduce(storesMember12, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))));
observe("reduce with a first value: a proxy", () => [0].reduce(storesMember12, (logged({ y: 2, x: 1 }))));
observe("reduce with a first value: an object again", () => [0].reduce(storesMember12, (({ x: 1, y: 2 }))));

storesMember13(({ x: 1, y: 2 }));
storesMember13(({ x: 1, y: 2 }));
observe("reduce without a first value: an object", () => [(({ x: 1, y: 2 })), 0].reduce(storesMember13));
observe("reduce without a first value: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), 0].reduce(storesMember13));
observe("reduce without a first value: a proxy", () => [(logged({ y: 2, x: 1 })), 0].reduce(storesMember13));
observe("reduce without a first value: an object again", () => [(({ x: 1, y: 2 })), 0].reduce(storesMember13));

storesMember14(({ x: 1, y: 2 }));
storesMember14(({ x: 1, y: 2 }));
observe("reduceRight: an object", () => [0].reduceRight(storesMember14, (({ x: 1, y: 2 }))));
observe("reduceRight: accessors", () => [0].reduceRight(storesMember14, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))));
observe("reduceRight: a proxy", () => [0].reduceRight(storesMember14, (logged({ y: 2, x: 1 }))));
observe("reduceRight: an object again", () => [0].reduceRight(storesMember14, (({ x: 1, y: 2 }))));

storesMember15(({ x: 1, y: 2 }));
storesMember15(({ x: 1, y: 2 }));
observe("Array.from of an array: an object", () => Array.from([(({ x: 1, y: 2 }))], storesMember15));
observe("Array.from of an array: accessors", () => Array.from([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))], storesMember15));
observe("Array.from of an array: a proxy", () => Array.from([(logged({ y: 2, x: 1 }))], storesMember15));
observe("Array.from of an array: an object again", () => Array.from([(({ x: 1, y: 2 }))], storesMember15));

storesMember16(({ x: 1, y: 2 }));
storesMember16(({ x: 1, y: 2 }));
observe("Array.from of an array-like: an object", () => Array.from({ length: 1, 0: (({ x: 1, y: 2 })) }, storesMember16));
observe("Array.from of an array-like: accessors", () => Array.from({ length: 1, 0: (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })) }, storesMember16));
observe("Array.from of an array-like: a proxy", () => Array.from({ length: 1, 0: (logged({ y: 2, x: 1 })) }, storesMember16));
observe("Array.from of an array-like: an object again", () => Array.from({ length: 1, 0: (({ x: 1, y: 2 })) }, storesMember16));

storesMember17(({ x: 1, y: 2 }));
storesMember17(({ x: 1, y: 2 }));
observe("Array.from of a set: an object", () => Array.from(new Set([(({ x: 1, y: 2 }))]), storesMember17));
observe("Array.from of a set: accessors", () => Array.from(new Set([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]), storesMember17));
observe("Array.from of a set: a proxy", () => Array.from(new Set([(logged({ y: 2, x: 1 }))]), storesMember17));
observe("Array.from of a set: an object again", () => Array.from(new Set([(({ x: 1, y: 2 }))]), storesMember17));

storesMember18(({ x: 1, y: 2 }));
storesMember18(({ x: 1, y: 2 }));
observe("forEach of an array-like: an object", () => Array.prototype.forEach.call({ length: 1, 0: (({ x: 1, y: 2 })) }, storesMember18));
observe("forEach of an array-like: accessors", () => Array.prototype.forEach.call({ length: 1, 0: (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })) }, storesMember18));
observe("forEach of an array-like: a proxy", () => Array.prototype.forEach.call({ length: 1, 0: (logged({ y: 2, x: 1 })) }, storesMember18));
observe("forEach of an array-like: an object again", () => Array.prototype.forEach.call({ length: 1, 0: (({ x: 1, y: 2 })) }, storesMember18));

storesMember19(({ x: 1, y: 2 }));
storesMember19(({ x: 1, y: 2 }));
observe("forEach of a set: an object", () => new Set([(({ x: 1, y: 2 }))]).forEach(storesMember19));
observe("forEach of a set: accessors", () => new Set([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]).forEach(storesMember19));
observe("forEach of a set: a proxy", () => new Set([(logged({ y: 2, x: 1 }))]).forEach(storesMember19));
observe("forEach of a set: an object again", () => new Set([(({ x: 1, y: 2 }))]).forEach(storesMember19));

storesMember20(({ x: 1, y: 2 }));
storesMember20(({ x: 1, y: 2 }));
observe("forEach of a map: an object", () => new Map([[0, (({ x: 1, y: 2 }))]]).forEach(storesMember20));
observe("forEach of a map: accessors", () => new Map([[0, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]]).forEach(storesMember20));
observe("forEach of a map: a proxy", () => new Map([[0, (logged({ y: 2, x: 1 }))]]).forEach(storesMember20));
observe("forEach of a map: an object again", () => new Map([[0, (({ x: 1, y: 2 }))]]).forEach(storesMember20));

storesMember21(({ x: 1, y: 2 }));
storesMember21(({ x: 1, y: 2 }));
observe("map of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().map(storesMember21).toArray());
observe("map of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().map(storesMember21).toArray());
observe("map of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().map(storesMember21).toArray());
observe("map of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().map(storesMember21).toArray());

storesMember22(({ x: 1, y: 2 }));
storesMember22(({ x: 1, y: 2 }));
observe("forEach of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().forEach(storesMember22));
observe("forEach of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().forEach(storesMember22));
observe("forEach of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().forEach(storesMember22));
observe("forEach of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().forEach(storesMember22));

storesMember23(({ x: 1, y: 2 }));
storesMember23(({ x: 1, y: 2 }));
observe("reduce of an iterator: an object", () => [0].values().reduce(storesMember23, (({ x: 1, y: 2 }))));
observe("reduce of an iterator: accessors", () => [0].values().reduce(storesMember23, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))));
observe("reduce of an iterator: a proxy", () => [0].values().reduce(storesMember23, (logged({ y: 2, x: 1 }))));
observe("reduce of an iterator: an object again", () => [0].values().reduce(storesMember23, (({ x: 1, y: 2 }))));

storesMember24(({ x: 1, y: 2 }));
storesMember24(({ x: 1, y: 2 }));
observe("filter of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().filter(storesMember24).toArray());
observe("filter of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().filter(storesMember24).toArray());
observe("filter of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().filter(storesMember24).toArray());
observe("filter of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().filter(storesMember24).toArray());

storesMember25(({ x: 1, y: 2 }));
storesMember25(({ x: 1, y: 2 }));
observe("find of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().find(storesMember25));
observe("find of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().find(storesMember25));
observe("find of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().find(storesMember25));
observe("find of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().find(storesMember25));

storesMember26(({ x: 1, y: 2 }));
storesMember26(({ x: 1, y: 2 }));
observe("some of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().some(storesMember26));
observe("some of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().some(storesMember26));
observe("some of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().some(storesMember26));
observe("some of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().some(storesMember26));

storesMember27(({ x: 1, y: 2 }));
storesMember27(({ x: 1, y: 2 }));
observe("every of an iterator: an object", () => [(({ x: 1, y: 2 }))].values().every(storesMember27));
observe("every of an iterator: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].values().every(storesMember27));
observe("every of an iterator: a proxy", () => [(logged({ y: 2, x: 1 }))].values().every(storesMember27));
observe("every of an iterator: an object again", () => [(({ x: 1, y: 2 }))].values().every(storesMember27));

storesMember28(({ x: 1, y: 2 }));
storesMember28(({ x: 1, y: 2 }));
observe("findLastIndex: an object", () => [(({ x: 1, y: 2 }))].findLastIndex(storesMember28));
observe("findLastIndex: accessors", () => [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].findLastIndex(storesMember28));
observe("findLastIndex: a proxy", () => [(logged({ y: 2, x: 1 }))].findLastIndex(storesMember28));
observe("findLastIndex: an object again", () => [(({ x: 1, y: 2 }))].findLastIndex(storesMember28));

storesMember29(({ x: 1, y: 2 }));
storesMember29(({ x: 1, y: 2 }));
observe("a typed array made from a list: an object", () => Uint8Array.from([(({ x: 1, y: 2 }))], storesMember29));
observe("a typed array made from a list: accessors", () => Uint8Array.from([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))], storesMember29));
observe("a typed array made from a list: a proxy", () => Uint8Array.from([(logged({ y: 2, x: 1 }))], storesMember29));
observe("a typed array made from a list: an object again", () => Uint8Array.from([(({ x: 1, y: 2 }))], storesMember29));

storesMember30(({ x: 1, y: 2 }));
storesMember30(({ x: 1, y: 2 }));
observe("adopt of a disposable stack: an object", () => (stack => (stack.adopt((({ x: 1, y: 2 })), storesMember30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: accessors", () => (stack => (stack.adopt((({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), storesMember30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: a proxy", () => (stack => (stack.adopt((logged({ y: 2, x: 1 })), storesMember30), stack.dispose()))(new DisposableStack()));
observe("adopt of a disposable stack: an object again", () => (stack => (stack.adopt((({ x: 1, y: 2 })), storesMember30), stack.dispose()))(new DisposableStack()));

storesMember31(({ x: 1, y: 2 }));
storesMember31(({ x: 1, y: 2 }));
observe("getOrInsertComputed of a map: an object", () => new Map().getOrInsertComputed((({ x: 1, y: 2 })), storesMember31));
observe("getOrInsertComputed of a map: accessors", () => new Map().getOrInsertComputed((({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), storesMember31));
observe("getOrInsertComputed of a map: a proxy", () => new Map().getOrInsertComputed((logged({ y: 2, x: 1 })), storesMember31));
observe("getOrInsertComputed of a map: an object again", () => new Map().getOrInsertComputed((({ x: 1, y: 2 })), storesMember31));

storesMember32(({ x: 1, y: 2 }));
storesMember32(({ x: 1, y: 2 }));
observe("Object.groupBy: an object", () => Object.groupBy([(({ x: 1, y: 2 }))], storesMember32));
observe("Object.groupBy: accessors", () => Object.groupBy([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))], storesMember32));
observe("Object.groupBy: a proxy", () => Object.groupBy([(logged({ y: 2, x: 1 }))], storesMember32));
observe("Object.groupBy: an object again", () => Object.groupBy([(({ x: 1, y: 2 }))], storesMember32));

storesMember33(({ x: 1, y: 2 }));
storesMember33(({ x: 1, y: 2 }));
observe("Map.groupBy: an object", () => Map.groupBy([(({ x: 1, y: 2 }))], storesMember33));
observe("Map.groupBy: accessors", () => Map.groupBy([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))], storesMember33));
observe("Map.groupBy: a proxy", () => Map.groupBy([(logged({ y: 2, x: 1 }))], storesMember33));
observe("Map.groupBy: an object again", () => Map.groupBy([(({ x: 1, y: 2 }))], storesMember33));

storesMember34(({ x: 1, y: 2 }));
storesMember34(({ x: 1, y: 2 }));
observe("Reflect.apply: an object", () => Reflect.apply(storesMember34, undefined, [(({ x: 1, y: 2 }))]));
observe("Reflect.apply: accessors", () => Reflect.apply(storesMember34, undefined, [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]));
observe("Reflect.apply: a proxy", () => Reflect.apply(storesMember34, undefined, [(logged({ y: 2, x: 1 }))]));
observe("Reflect.apply: an object again", () => Reflect.apply(storesMember34, undefined, [(({ x: 1, y: 2 }))]));

storesMember35(({ x: 1, y: 2 }));
storesMember35(({ x: 1, y: 2 }));
observe("Reflect.apply with an array-like: an object", () => Reflect.apply(storesMember35, undefined, { length: 1, 0: (({ x: 1, y: 2 })) }));
observe("Reflect.apply with an array-like: accessors", () => Reflect.apply(storesMember35, undefined, { length: 1, 0: (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })) }));
observe("Reflect.apply with an array-like: a proxy", () => Reflect.apply(storesMember35, undefined, { length: 1, 0: (logged({ y: 2, x: 1 })) }));
observe("Reflect.apply with an array-like: an object again", () => Reflect.apply(storesMember35, undefined, { length: 1, 0: (({ x: 1, y: 2 })) }));

storesMember36(({ x: 1, y: 2 }));
storesMember36(({ x: 1, y: 2 }));
observe("Reflect.construct: an object", () => Reflect.construct(storesMember36, [(({ x: 1, y: 2 }))]));
observe("Reflect.construct: accessors", () => Reflect.construct(storesMember36, [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]));
observe("Reflect.construct: a proxy", () => Reflect.construct(storesMember36, [(logged({ y: 2, x: 1 }))]));
observe("Reflect.construct: an object again", () => Reflect.construct(storesMember36, [(({ x: 1, y: 2 }))]));

storesMember37(({ x: 1, y: 2 }));
storesMember37(({ x: 1, y: 2 }));
observe("call: an object", () => storesMember37.call(undefined, (({ x: 1, y: 2 }))));
observe("call: accessors", () => storesMember37.call(undefined, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))));
observe("call: a proxy", () => storesMember37.call(undefined, (logged({ y: 2, x: 1 }))));
observe("call: an object again", () => storesMember37.call(undefined, (({ x: 1, y: 2 }))));

storesMember38(({ x: 1, y: 2 }));
storesMember38(({ x: 1, y: 2 }));
observe("apply: an object", () => storesMember38.apply(undefined, [(({ x: 1, y: 2 }))]));
observe("apply: accessors", () => storesMember38.apply(undefined, [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))]));
observe("apply: a proxy", () => storesMember38.apply(undefined, [(logged({ y: 2, x: 1 }))]));
observe("apply: an object again", () => storesMember38.apply(undefined, [(({ x: 1, y: 2 }))]));

storesMember39(({ x: 1, y: 2 }));
storesMember39(({ x: 1, y: 2 }));
observe("bind: an object", () => storesMember39.bind(undefined, (({ x: 1, y: 2 })))());
observe("bind: accessors", () => storesMember39.bind(undefined, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })))());
observe("bind: a proxy", () => storesMember39.bind(undefined, (logged({ y: 2, x: 1 })))());
observe("bind: an object again", () => storesMember39.bind(undefined, (({ x: 1, y: 2 })))());

storesMember40(({ x: 1, y: 2 }));
storesMember40(({ x: 1, y: 2 }));
observe("a setter: an object", () => Object.defineProperty({}, "key", { set: storesMember40 }).key = (({ x: 1, y: 2 })));
observe("a setter: accessors", () => Object.defineProperty({}, "key", { set: storesMember40 }).key = (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })));
observe("a setter: a proxy", () => Object.defineProperty({}, "key", { set: storesMember40 }).key = (logged({ y: 2, x: 1 })));
observe("a setter: an object again", () => Object.defineProperty({}, "key", { set: storesMember40 }).key = (({ x: 1, y: 2 })));

storesMember41(({ x: 1, y: 2 }));
storesMember41(({ x: 1, y: 2 }));
observe("Symbol.hasInstance: an object", () => (({ x: 1, y: 2 })) instanceof { [Symbol.hasInstance]: storesMember41 });
observe("Symbol.hasInstance: accessors", () => (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })) instanceof { [Symbol.hasInstance]: storesMember41 });
observe("Symbol.hasInstance: a proxy", () => (logged({ y: 2, x: 1 })) instanceof { [Symbol.hasInstance]: storesMember41 });
observe("Symbol.hasInstance: an object again", () => (({ x: 1, y: 2 })) instanceof { [Symbol.hasInstance]: storesMember41 });

storesMember42(({ x: 1, y: 2 }));
storesMember42(({ x: 1, y: 2 }));
observe("the set trap of a proxy: an object", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(storesMember42, undefined, [value]), true) }).key = (({ x: 1, y: 2 })));
observe("the set trap of a proxy: accessors", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(storesMember42, undefined, [value]), true) }).key = (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })));
observe("the set trap of a proxy: a proxy", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(storesMember42, undefined, [value]), true) }).key = (logged({ y: 2, x: 1 })));
observe("the set trap of a proxy: an object again", () => new Proxy({}, { set: (target, key, value) => (Reflect.apply(storesMember42, undefined, [value]), true) }).key = (({ x: 1, y: 2 })));

storesMember43(({ x: 1, y: 2 }));
storesMember43(({ x: 1, y: 2 }));
observe("a replacer of JSON.stringify: an object", () => JSON.stringify(0, () => void [(({ x: 1, y: 2 }))].forEach(storesMember43)));
observe("a replacer of JSON.stringify: accessors", () => JSON.stringify(0, () => void [(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))].forEach(storesMember43)));
observe("a replacer of JSON.stringify: a proxy", () => JSON.stringify(0, () => void [(logged({ y: 2, x: 1 }))].forEach(storesMember43)));
observe("a replacer of JSON.stringify: an object again", () => JSON.stringify(0, () => void [(({ x: 1, y: 2 }))].forEach(storesMember43)));

storesMember44(0, ({ x: 1, y: 2 }));
storesMember44(0, ({ x: 1, y: 2 }));
observe("a tagged template: an object", () => storesMember44.bind(undefined)`${(({ x: 1, y: 2 }))}`);
observe("a tagged template: accessors", () => storesMember44.bind(undefined)`${(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))}`);
observe("a tagged template: a proxy", () => storesMember44.bind(undefined)`${(logged({ y: 2, x: 1 }))}`);
observe("a tagged template: an object again", () => storesMember44.bind(undefined)`${(({ x: 1, y: 2 }))}`);

storesMember45(0, ({ x: 1, y: 2 }));
storesMember45(0, ({ x: 1, y: 2 }));
observe("a replacer of JSON.stringify, second parameter: an object", () => JSON.stringify((({ x: 1, y: 2 })), storesMember45));
observe("a replacer of JSON.stringify, second parameter: accessors", () => JSON.stringify((({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })), storesMember45));
observe("a replacer of JSON.stringify, second parameter: a proxy", () => JSON.stringify((logged({ y: 2, x: 1 })), storesMember45));
observe("a replacer of JSON.stringify, second parameter: an object again", () => JSON.stringify((({ x: 1, y: 2 })), storesMember45));

storesMember46(({ x: 1, y: 2 }));
storesMember46(({ x: 1, y: 2 }));
observe("a listener of an event emitter: an object", () => new (require("node:events").EventEmitter)().once("value", storesMember46).emit("value", (({ x: 1, y: 2 }))));
observe("a listener of an event emitter: accessors", () => new (require("node:events").EventEmitter)().once("value", storesMember46).emit("value", (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))));
observe("a listener of an event emitter: a proxy", () => new (require("node:events").EventEmitter)().once("value", storesMember46).emit("value", (logged({ y: 2, x: 1 }))));
observe("a listener of an event emitter: an object again", () => new (require("node:events").EventEmitter)().once("value", storesMember46).emit("value", (({ x: 1, y: 2 }))));
