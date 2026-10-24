import { isMainThread, parentPort, Worker } from "node:worker_threads";

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

async function outcome(run) {
  log.length = 0;
  try {
    const value = await run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

async function attempt(label, run) {
  console.log(label + " -> " + (await outcome(run)));
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

const made = {
  arrays: [
    ["an array", () => [5, 6]],
    ["a subclass", () => Odd.of(5, 6)],
    ["an array with a hole", () => [5, , 6]],
    ["a set", () => new Set([5, 6])],
    ["a map", () => new Map([[5, 6]])],
    ["a typed array", () => new Uint8Array([5, 6])],
    ["an object with a length", () => ({ 0: 5, length: 7 })],
    ["a frozen array", () => Object.freeze([5, 6])],
    ["a text", () => "ab"],
    ["a proxy", () => logged([5, 6])],
  ],
  strings: [
    ["a text", () => "abc"],
    ["a String object", () => new String("xyz")],
    ["an array", () => ["abc"]],
    ["a number", () => 65],
    ["an object with charCodeAt", () => ({ charCodeAt() { return 1; } })],
  ],
  numbers: [
    ["an integer", () => 7],
    ["a text", () => "3"],
    ["a Number object", () => new Number(3.5)],
    ["a bigint", () => 10n],
    ["the largest int32", () => 2147483647],
    ["minus zero", () => -0],
    ["undefined", () => undefined],
    ["not a number", () => NaN],
    ["a Boolean object", () => new Boolean(true)],
  ],
  objects: [
    ["an object", () => ({ x: 1, y: 2 })],
    ["accessors", () => ({ get x() { return 10; }, get y() { return 20; } })],
    ["a frozen object", () => Object.freeze({ x: 5, y: 6 })],
    ["texts in another order", () => ({ y: "2", x: "1" })],
    ["inherited members", () => Object.create({ x: 3, y: 4 })],
    ["an instance of a class", () => new (class Point { x = 1; y = 2; })()],
  ],
};

let worker;
function ask(kind, index) {
  return new Promise((resolve, reject) => {
    worker.once("message", answer => ("failed" in answer ? reject(new globalThis[answer.failed]("in the worker")) : resolve(answer.value)));
    worker.postMessage([kind, index]);
  });
}

async function pushes(index) {
  const a = await ask("arrays", index);
  a.push(1);
  return [a.length];
}

async function iterates(index) {
  const a = await ask("arrays", index);
  const seen = [];
  for (const x of a) seen.push(x);
  return [seen];
}

async function readsCharCode(index) {
  const s = await ask("strings", index);
  return [s.charCodeAt(0)];
}

async function truncates(index) {
  const n = await ask("numbers", index);
  return [n | 0];
}

async function addsOne(index) {
  const n = await ask("numbers", index);
  return [n + 1];
}

async function addsMembers(index) {
  const o = await ask("objects", index);
  return [o.x + o.y];
}

async function storesMember(index) {
  const o = await ask("objects", index);
  o.x = 1;
  return [o];
}

const table = [
  ["pushes", pushes, "arrays"],
  ["iterates", iterates, "arrays"],
  ["readsCharCode", readsCharCode, "strings"],
  ["truncates", truncates, "numbers"],
  ["addsOne", addsOne, "numbers"],
  ["addsMembers", addsMembers, "objects"],
  ["storesMember", storesMember, "objects"],
];

async function everyCase(round) {
  for (const [name, use, kind] of table) {
    for (const index of [...made[kind].keys(), 0]) await attempt(round + " " + name + " " + made[kind][index][0], () => use(index));
  }
}

if (isMainThread) {
  console.log("strict:", (function () { return this === undefined; })());
  worker = new Worker(new URL(import.meta.url));
  await everyCase("at first");
  for (let i = 0; i < 100; i++) {
    await pushes(0);
    await iterates(0);
    await readsCharCode(0);
    await truncates(0);
    await addsOne(0);
    await addsMembers(0);
    await storesMember(0);
  }
  await everyCase("after 100");
  await worker.terminate();
} else {
  parentPort.on("message", ([kind, index]) => {
    try {
      parentPort.postMessage({ value: made[kind][index][1]() });
    } catch (error) {
      parentPort.postMessage({ failed: error.constructor.name });
    }
  });
}
