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

function* pushes() {
  let a = yield "ready";
  for (;;) {
    try {
      a.push(1);
      a = yield a.length;
    } catch (thrown) {
      a = yield ["caught", thrown];
    } finally {
      log.push("finally");
    }
  }
}
function* addsOne() {
  let n = yield "ready";
  for (;;) {
    try {
      n = yield n + 1;
    } catch (thrown) {
      n = yield thrown | 0;
    }
  }
}
function* addsMembers() {
  let o = yield "ready";
  for (;;) {
    try {
      o = yield o.x + o.y;
    } catch (thrown) {
      o = yield thrown.x + thrown.y;
    }
  }
}

const arrays = [["an array", () => [5, 6]], ["a subclass", () => Odd.of(5, 6)], ["an array-like", () => ({ length: 7, push(value) { log.push("own push " + value); } })], ["a proxy", () => logged([5, 6])], ["a frozen array", () => Object.freeze([5, 6])], ["undefined", () => undefined]];
const numbers = [["an integer", () => 7], ["a text", () => "3"], ["an object with valueOf", () => ({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; } })], ["a bigint", () => 10n], ["the largest int32", () => 2147483647], ["undefined", () => undefined]];
const objects = [["an object", () => ({ x: 1, y: 2 })], ["accessors", () => ({ get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } })], ["a proxy", () => logged({ y: 2, x: 1 })], ["texts", () => ({ y: "2", x: "1" })], ["null", () => null]];

for (const [name, start, values] of [["pushes", pushes, arrays], ["addsOne", addsOne, numbers], ["addsMembers", addsMembers, objects]]) {
  let generator = start();
  generator.next();
  for (let i = 0; i < 2000; i++) generator.next(values[0][1]());
  const step = (label, run) =>
    attempt(name + " " + label, () => {
      const result = run();
      if (result.done) {
        generator = start();
        generator.next();
      }
      return [result.done, result.value];
    });
  for (const [label, make] of [...values, values[0]]) {
    step("sent " + label, () => generator.next(make()));
    step("thrown " + label, () => generator.throw(make()));
    step("sent " + values[0][0] + " afterwards", () => generator.next(values[0][1]()));
  }
  for (const [label, make] of values) step("returned " + label, () => generator.return(make()));
}
