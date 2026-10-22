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

function pushes(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    const a = list[i];
    a.push(1);
    order.push(a.length);
    order.push(i + ">");
  }
  return "done";
}

function pushesAndCatches(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    try {
      const a = list[i];
      a.push(1);
      order.push(a.length);
    } catch (error) {
      order.push(error.constructor.name);
      continue;
    } finally {
      order.push("f" + i);
    }
    order.push(i + ">");
  }
  return "done";
}

function iterates(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    const a = list[i];
    const seen = [];
    for (const x of a) seen.push(x);
    order.push(seen);
    order.push(i + ">");
  }
  return "done";
}

function iteratesAndCatches(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    try {
      const a = list[i];
      const seen = [];
      for (const x of a) seen.push(x);
      order.push(seen);
    } catch (error) {
      order.push(error.constructor.name);
      continue;
    } finally {
      order.push("f" + i);
    }
    order.push(i + ">");
  }
  return "done";
}

function readsCharCode(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    const s = list[i];
    order.push(s.charCodeAt(0));
    order.push(i + ">");
  }
  return "done";
}

function readsCharCodeAndCatches(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    try {
      const s = list[i];
      order.push(s.charCodeAt(0));
    } catch (error) {
      order.push(error.constructor.name);
      continue;
    } finally {
      order.push("f" + i);
    }
    order.push(i + ">");
  }
  return "done";
}

function truncates(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    const n = list[i];
    order.push(n | 0);
    order.push(i + ">");
  }
  return "done";
}

function truncatesAndCatches(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    try {
      const n = list[i];
      order.push(n | 0);
    } catch (error) {
      order.push(error.constructor.name);
      continue;
    } finally {
      order.push("f" + i);
    }
    order.push(i + ">");
  }
  return "done";
}

function addsOne(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    const n = list[i];
    order.push(n + 1);
    order.push(i + ">");
  }
  return "done";
}

function addsOneAndCatches(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    try {
      const n = list[i];
      order.push(n + 1);
    } catch (error) {
      order.push(error.constructor.name);
      continue;
    } finally {
      order.push("f" + i);
    }
    order.push(i + ">");
  }
  return "done";
}

function calls(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    const f = list[i];
    order.push(f(1));
    order.push(i + ">");
  }
  return "done";
}

function callsAndCatches(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    try {
      const f = list[i];
      order.push(f(1));
    } catch (error) {
      order.push(error.constructor.name);
      continue;
    } finally {
      order.push("f" + i);
    }
    order.push(i + ">");
  }
  return "done";
}

function addsMembers(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    const o = list[i];
    order.push(o.x + o.y);
    order.push(i + ">");
  }
  return "done";
}

function addsMembersAndCatches(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    try {
      const o = list[i];
      order.push(o.x + o.y);
    } catch (error) {
      order.push(error.constructor.name);
      continue;
    } finally {
      order.push("f" + i);
    }
    order.push(i + ">");
  }
  return "done";
}

function storesMember(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    const o = list[i];
    o.x = 1;
    order.push(o.x);
    order.push(i + ">");
  }
  return "done";
}

function storesMemberAndCatches(list, order) {
  for (let i = 0; i < list.length; i++) {
    order.push("<" + i);
    try {
      const o = list[i];
      o.x = 1;
      order.push(o.x);
    } catch (error) {
      order.push(error.constructor.name);
      continue;
    } finally {
      order.push("f" + i);
    }
    order.push(i + ">");
  }
  return "done";
}

const table = [
  ["pushes", pushes, arrays],
  ["pushesAndCatches", pushesAndCatches, arrays],
  ["iterates", iterates, arrays],
  ["iteratesAndCatches", iteratesAndCatches, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["readsCharCodeAndCatches", readsCharCodeAndCatches, strings],
  ["truncates", truncates, numbers],
  ["truncatesAndCatches", truncatesAndCatches, numbers],
  ["addsOne", addsOne, numbers],
  ["addsOneAndCatches", addsOneAndCatches, numbers],
  ["calls", calls, functions],
  ["callsAndCatches", callsAndCatches, functions],
  ["addsMembers", addsMembers, objects],
  ["addsMembersAndCatches", addsMembersAndCatches, objects],
  ["storesMember", storesMember, objects],
  ["storesMemberAndCatches", storesMemberAndCatches, objects],
];
const patterns = ["0000", "0100", "1000", "0001", "0101", "1111", "012340", "0011223344", "43210"];

console.log("strict:", (function () { return this === undefined; })());
for (const [name, use, values] of table) {
  for (let i = 0; i < 500; i++) use([values[0][1](), values[0][1](), values[0][1]()], []);
  for (const pattern of patterns) {
    const order = [];
    const end = outcome(() => use([...pattern].map(digit => values[digit][1]()), order));
    console.log(name + " " + pattern + " -> " + order.map(show).join(" ") + " " + end);
  }
}
