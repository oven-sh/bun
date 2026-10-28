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

let entered = 0;

function pushes(a) {
  a.push(1);
  return a.length;
}

function pushesAtLength(a) {
  let result;
  for (let round = 0; round < 1; round++) {
    try {
      a.push(1);
      result = a.length;
    } finally {
      entered++;
    }
  }
  return result;
}

function iterates(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}

function iteratesAtLength(a) {
  let result;
  for (let round = 0; round < 1; round++) {
    try {
      const seen = [];
      for (const x of a) seen.push(x);
      result = seen;
    } finally {
      entered++;
    }
  }
  return result;
}

function readsCharCode(s) {
  return s.charCodeAt(0);
}

function readsCharCodeAtLength(s) {
  let result;
  for (let round = 0; round < 1; round++) {
    try {
      result = s.charCodeAt(0);
    } finally {
      entered++;
    }
  }
  return result;
}

function truncates(n) {
  return n | 0;
}

function truncatesAtLength(n) {
  let result;
  for (let round = 0; round < 1; round++) {
    try {
      result = n | 0;
    } finally {
      entered++;
    }
  }
  return result;
}

function addsOne(n) {
  return n + 1;
}

function addsOneAtLength(n) {
  let result;
  for (let round = 0; round < 1; round++) {
    try {
      result = n + 1;
    } finally {
      entered++;
    }
  }
  return result;
}

function calls(f) {
  return f(1);
}

function callsAtLength(f) {
  let result;
  for (let round = 0; round < 1; round++) {
    try {
      result = f(1);
    } finally {
      entered++;
    }
  }
  return result;
}

function addsMembers(o) {
  return o.x + o.y;
}

function addsMembersAtLength(o) {
  let result;
  for (let round = 0; round < 1; round++) {
    try {
      result = o.x + o.y;
    } finally {
      entered++;
    }
  }
  return result;
}

function storesMember(o) {
  o.x = 1;
  return o;
}

function storesMemberAtLength(o) {
  let result;
  for (let round = 0; round < 1; round++) {
    try {
      o.x = 1;
      result = o;
    } finally {
      entered++;
    }
  }
  return result;
}

const table = [
  ["pushes", pushes, arrays],
  ["pushesAtLength", pushesAtLength, arrays],
  ["iterates", iterates, arrays],
  ["iteratesAtLength", iteratesAtLength, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["readsCharCodeAtLength", readsCharCodeAtLength, strings],
  ["truncates", truncates, numbers],
  ["truncatesAtLength", truncatesAtLength, numbers],
  ["addsOne", addsOne, numbers],
  ["addsOneAtLength", addsOneAtLength, numbers],
  ["calls", calls, functions],
  ["callsAtLength", callsAtLength, functions],
  ["addsMembers", addsMembers, objects],
  ["addsMembersAtLength", addsMembersAtLength, objects],
  ["storesMember", storesMember, objects],
  ["storesMemberAtLength", storesMemberAtLength, objects],
];

console.log("strict:", (function () { return this === undefined; })());
for (const [name, use, values] of table) {
  for (const [label, make] of values.slice(1)) {
    const counts = new Map();
    for (let i = 0; i < 400; i++) {
      const line = (i % 2) + ": " + outcome(() => use(i % 2 ? make() : values[0][1]()));
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    console.log(name + " " + label + " -> " + [...counts].map(([line, count]) => line + " x" + count).join(" ; "));
  }
}
console.log("entered", entered);
