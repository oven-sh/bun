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

console.log("strict:", (function () { return this === undefined; })());

async function adds1(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds2(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds3(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds4(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds5(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds6(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds7(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds8(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds9(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds10(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds11(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds12(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds13(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds14(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

async function adds15(settle) {
  const o = await new Promise(settle);
  return [o.x + o.y];
}

const { EventEmitter } = require("node:events");

async function main() {
  await attempt("forEach: resolved where the compiler sees it", () => adds1(resolve => resolve({ x: 1, y: 2 })));
  await attempt("forEach: an object", () => adds1((resolve, reject) => void ([{ x: 1, y: 2 }].forEach(resolve))));
  await attempt("forEach: accessors", () => adds1((resolve, reject) => void ([{ get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } }].forEach(resolve))));
  await attempt("forEach: a text", () => adds1((resolve, reject) => void (["xy"].forEach(resolve))));
  await attempt("forEach: resolved where the compiler sees it, again", () => adds1(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a timer with an argument: resolved where the compiler sees it", () => adds2(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a timer with an argument: an object", () => adds2((resolve, reject) => void (setTimeout(resolve, 0, { x: 1, y: 2 }))));
  await attempt("a timer with an argument: accessors", () => adds2((resolve, reject) => void (setTimeout(resolve, 0, { get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } }))));
  await attempt("a timer with an argument: a text", () => adds2((resolve, reject) => void (setTimeout(resolve, 0, "xy"))));
  await attempt("a timer with an argument: resolved where the compiler sees it, again", () => adds2(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a timer without an argument: resolved where the compiler sees it", () => adds3(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a timer without an argument: an object", () => adds3((resolve, reject) => void (setTimeout(resolve, 0))));
  await attempt("a timer without an argument: accessors", () => adds3((resolve, reject) => void (setTimeout(resolve, 0))));
  await attempt("a timer without an argument: a text", () => adds3((resolve, reject) => void (setTimeout(resolve, 0))));
  await attempt("a timer without an argument: resolved where the compiler sees it, again", () => adds3(resolve => resolve({ x: 1, y: 2 })));
  await attempt("setImmediate: resolved where the compiler sees it", () => adds4(resolve => resolve({ x: 1, y: 2 })));
  await attempt("setImmediate: an object", () => adds4((resolve, reject) => void (setImmediate(resolve, { x: 1, y: 2 }))));
  await attempt("setImmediate: accessors", () => adds4((resolve, reject) => void (setImmediate(resolve, { get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } }))));
  await attempt("setImmediate: a text", () => adds4((resolve, reject) => void (setImmediate(resolve, "xy"))));
  await attempt("setImmediate: resolved where the compiler sees it, again", () => adds4(resolve => resolve({ x: 1, y: 2 })));
  await attempt("process.nextTick: resolved where the compiler sees it", () => adds5(resolve => resolve({ x: 1, y: 2 })));
  await attempt("process.nextTick: an object", () => adds5((resolve, reject) => void (process.nextTick(resolve, { x: 1, y: 2 }))));
  await attempt("process.nextTick: accessors", () => adds5((resolve, reject) => void (process.nextTick(resolve, { get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } }))));
  await attempt("process.nextTick: a text", () => adds5((resolve, reject) => void (process.nextTick(resolve, "xy"))));
  await attempt("process.nextTick: resolved where the compiler sees it, again", () => adds5(resolve => resolve({ x: 1, y: 2 })));
  await attempt("queueMicrotask: resolved where the compiler sees it", () => adds6(resolve => resolve({ x: 1, y: 2 })));
  await attempt("queueMicrotask: an object", () => adds6((resolve, reject) => void (queueMicrotask(resolve))));
  await attempt("queueMicrotask: accessors", () => adds6((resolve, reject) => void (queueMicrotask(resolve))));
  await attempt("queueMicrotask: a text", () => adds6((resolve, reject) => void (queueMicrotask(resolve))));
  await attempt("queueMicrotask: resolved where the compiler sees it, again", () => adds6(resolve => resolve({ x: 1, y: 2 })));
  await attempt("Reflect.apply: resolved where the compiler sees it", () => adds7(resolve => resolve({ x: 1, y: 2 })));
  await attempt("Reflect.apply: an object", () => adds7((resolve, reject) => void (Reflect.apply(resolve, undefined, [{ x: 1, y: 2 }]))));
  await attempt("Reflect.apply: accessors", () => adds7((resolve, reject) => void (Reflect.apply(resolve, undefined, [{ get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } }]))));
  await attempt("Reflect.apply: a text", () => adds7((resolve, reject) => void (Reflect.apply(resolve, undefined, ["xy"]))));
  await attempt("Reflect.apply: resolved where the compiler sees it, again", () => adds7(resolve => resolve({ x: 1, y: 2 })));
  await attempt("call: resolved where the compiler sees it", () => adds8(resolve => resolve({ x: 1, y: 2 })));
  await attempt("call: an object", () => adds8((resolve, reject) => void (resolve.call(undefined, { x: 1, y: 2 }))));
  await attempt("call: accessors", () => adds8((resolve, reject) => void (resolve.call(undefined, { get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } }))));
  await attempt("call: a text", () => adds8((resolve, reject) => void (resolve.call(undefined, "xy"))));
  await attempt("call: resolved where the compiler sees it, again", () => adds8(resolve => resolve({ x: 1, y: 2 })));
  await attempt("bind: resolved where the compiler sees it", () => adds9(resolve => resolve({ x: 1, y: 2 })));
  await attempt("bind: an object", () => adds9((resolve, reject) => void (resolve.bind(undefined, { x: 1, y: 2 })())));
  await attempt("bind: accessors", () => adds9((resolve, reject) => void (resolve.bind(undefined, { get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } })())));
  await attempt("bind: a text", () => adds9((resolve, reject) => void (resolve.bind(undefined, "xy")())));
  await attempt("bind: resolved where the compiler sees it, again", () => adds9(resolve => resolve({ x: 1, y: 2 })));
  await attempt("then of another promise: resolved where the compiler sees it", () => adds10(resolve => resolve({ x: 1, y: 2 })));
  await attempt("then of another promise: an object", () => adds10((resolve, reject) => void (Promise.resolve({ x: 1, y: 2 }).then(resolve))));
  await attempt("then of another promise: accessors", () => adds10((resolve, reject) => void (Promise.resolve({ get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } }).then(resolve))));
  await attempt("then of another promise: a text", () => adds10((resolve, reject) => void (Promise.resolve("xy").then(resolve))));
  await attempt("then of another promise: resolved where the compiler sees it, again", () => adds10(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a thenable: resolved where the compiler sees it", () => adds11(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a thenable: an object", () => adds11((resolve, reject) => void (resolve({ then(inner) { inner({ x: 1, y: 2 }); } }))));
  await attempt("a thenable: accessors", () => adds11((resolve, reject) => void (resolve({ then(inner) { inner({ get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } }); } }))));
  await attempt("a thenable: a text", () => adds11((resolve, reject) => void (resolve({ then(inner) { inner("xy"); } }))));
  await attempt("a thenable: resolved where the compiler sees it, again", () => adds11(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a listener of an event emitter: resolved where the compiler sees it", () => adds12(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a listener of an event emitter: an object", () => adds12((resolve, reject) => void (new EventEmitter().once("value", resolve).emit("value", { x: 1, y: 2 }))));
  await attempt("a listener of an event emitter: accessors", () => adds12((resolve, reject) => void (new EventEmitter().once("value", resolve).emit("value", { get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } }))));
  await attempt("a listener of an event emitter: a text", () => adds12((resolve, reject) => void (new EventEmitter().once("value", resolve).emit("value", "xy"))));
  await attempt("a listener of an event emitter: resolved where the compiler sees it, again", () => adds12(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a listener of an event target: resolved where the compiler sees it", () => adds13(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a listener of an event target: an object", () => adds13((resolve, reject) => void ((target => (target.addEventListener("value", resolve, { once: true }), target.dispatchEvent(new CustomEvent("value", { detail: { x: 1, y: 2 } }))))(new EventTarget()))));
  await attempt("a listener of an event target: accessors", () => adds13((resolve, reject) => void ((target => (target.addEventListener("value", resolve, { once: true }), target.dispatchEvent(new CustomEvent("value", { detail: { get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } } }))))(new EventTarget()))));
  await attempt("a listener of an event target: a text", () => adds13((resolve, reject) => void ((target => (target.addEventListener("value", resolve, { once: true }), target.dispatchEvent(new CustomEvent("value", { detail: "xy" }))))(new EventTarget()))));
  await attempt("a listener of an event target: resolved where the compiler sees it, again", () => adds13(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a setter: resolved where the compiler sees it", () => adds14(resolve => resolve({ x: 1, y: 2 })));
  await attempt("a setter: an object", () => adds14((resolve, reject) => void (Object.defineProperty({}, "key", { set: resolve }).key = { x: 1, y: 2 })));
  await attempt("a setter: accessors", () => adds14((resolve, reject) => void (Object.defineProperty({}, "key", { set: resolve }).key = { get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } })));
  await attempt("a setter: a text", () => adds14((resolve, reject) => void (Object.defineProperty({}, "key", { set: resolve }).key = "xy")));
  await attempt("a setter: resolved where the compiler sees it, again", () => adds14(resolve => resolve({ x: 1, y: 2 })));
  await attempt("reject handed to forEach: resolved where the compiler sees it", () => adds15(resolve => resolve({ x: 1, y: 2 })));
  await attempt("reject handed to forEach: an object", () => adds15((resolve, reject) => void ([{ x: 1, y: 2 }].forEach(reject))));
  await attempt("reject handed to forEach: accessors", () => adds15((resolve, reject) => void ([{ get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } }].forEach(reject))));
  await attempt("reject handed to forEach: a text", () => adds15((resolve, reject) => void (["xy"].forEach(reject))));
  await attempt("reject handed to forEach: resolved where the compiler sees it, again", () => adds15(resolve => resolve({ x: 1, y: 2 })));
}

main();
