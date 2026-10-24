"use strict";

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

console.log("strict:", (function () { return this === undefined; })());

function addsMembers1(o) {
  return o.x + o.y;
}
attempt("addsMembers: accessors comes first", () => addsMembers1(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })));
attempt("addsMembers: an object comes second", () => addsMembers1(({ x: 1, y: 2 })));
attempt("addsMembers: accessors comes third", () => addsMembers1(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })));

function addsMembers2(o) {
  return o.x + o.y;
}
attempt("addsMembers: a proxy comes first", () => addsMembers2(logged({ y: 2, x: 1 })));
attempt("addsMembers: an object comes second", () => addsMembers2(({ x: 1, y: 2 })));
attempt("addsMembers: a proxy comes third", () => addsMembers2(logged({ y: 2, x: 1 })));

function addsMembers3(o) {
  return o.x + o.y;
}
attempt("addsMembers: a frozen object comes first", () => addsMembers3(Object.freeze({ x: 5, y: 6 })));
attempt("addsMembers: an object comes second", () => addsMembers3(({ x: 1, y: 2 })));
attempt("addsMembers: a frozen object comes third", () => addsMembers3(Object.freeze({ x: 5, y: 6 })));

function addsMembers4(o) {
  return o.x + o.y;
}
attempt("addsMembers: texts in another order comes first", () => addsMembers4(({ y: "2", x: "1" })));
attempt("addsMembers: an object comes second", () => addsMembers4(({ x: 1, y: 2 })));
attempt("addsMembers: texts in another order comes third", () => addsMembers4(({ y: "2", x: "1" })));

function addsMembers5(o) {
  return o.x + o.y;
}
attempt("addsMembers: inherited members comes first", () => addsMembers5(Object.create({ x: 3, y: 4 })));
attempt("addsMembers: an object comes second", () => addsMembers5(({ x: 1, y: 2 })));
attempt("addsMembers: inherited members comes third", () => addsMembers5(Object.create({ x: 3, y: 4 })));

function storesMember1(o) {
  o.x = 1;
  return o;
}
attempt("storesMember: accessors comes first", () => storesMember1(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })));
attempt("storesMember: an object comes second", () => storesMember1(({ x: 1, y: 2 })));
attempt("storesMember: accessors comes third", () => storesMember1(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })));

function storesMember2(o) {
  o.x = 1;
  return o;
}
attempt("storesMember: a proxy comes first", () => storesMember2(logged({ y: 2, x: 1 })));
attempt("storesMember: an object comes second", () => storesMember2(({ x: 1, y: 2 })));
attempt("storesMember: a proxy comes third", () => storesMember2(logged({ y: 2, x: 1 })));

function storesMember3(o) {
  o.x = 1;
  return o;
}
attempt("storesMember: a frozen object comes first", () => storesMember3(Object.freeze({ x: 5, y: 6 })));
attempt("storesMember: an object comes second", () => storesMember3(({ x: 1, y: 2 })));
attempt("storesMember: a frozen object comes third", () => storesMember3(Object.freeze({ x: 5, y: 6 })));

function storesMember4(o) {
  o.x = 1;
  return o;
}
attempt("storesMember: texts in another order comes first", () => storesMember4(({ y: "2", x: "1" })));
attempt("storesMember: an object comes second", () => storesMember4(({ x: 1, y: 2 })));
attempt("storesMember: texts in another order comes third", () => storesMember4(({ y: "2", x: "1" })));

function storesMember5(o) {
  o.x = 1;
  return o;
}
attempt("storesMember: inherited members comes first", () => storesMember5(Object.create({ x: 3, y: 4 })));
attempt("storesMember: an object comes second", () => storesMember5(({ x: 1, y: 2 })));
attempt("storesMember: inherited members comes third", () => storesMember5(Object.create({ x: 3, y: 4 })));
