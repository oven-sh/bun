function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

async function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(await run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

const takers = [
  ["then", f => Promise.resolve(1).then(f)],
  ["then for a rejection", f => Promise.reject(new RangeError("no")).then(undefined, f)],
  ["catch", f => Promise.reject(new RangeError("no")).catch(f)],
  ["finally", f => Promise.resolve(1).finally(f)],
  ["new Promise", f => { const promise = new Promise(f); promise.catch(error => log.push("rejected with " + error.constructor.name)); return Promise.resolve().then(() => typeof promise); }],
  ["queueMicrotask", f => { queueMicrotask(f); return new Promise(resolve => setTimeout(resolve, 0)); }],
  ["new Proxy with it as a trap", f => new Proxy({}, { get: f }).x],
  ["a getter", f => Object.defineProperty({}, "x", { get: f }).x],
  ["valueOf", f => +{ valueOf: f, toString: () => "7" }],
  ["Symbol.toPrimitive", f => +{ [Symbol.toPrimitive]: f, valueOf: () => 7 }],
  ["Symbol.iterator", f => [...{ [Symbol.iterator]: f }]],
  ["toJSON", f => JSON.stringify({ toJSON: f, a: 1 })],
  ["an emitter's listener", f => new (require("node:events"))().on("go", f).emit("go")],
  ["an event target's listener", f => { const target = new EventTarget(); target.addEventListener("go", f); return target.dispatchEvent(new Event("go")); }],
  ["Function.prototype.call", f => Function.prototype.call.call(f, null, 1)],
  ["Function.prototype.bind", f => Function.prototype.bind.call(f, null)],
  ["Function.prototype.toString", f => typeof Function.prototype.toString.call(f)],
  ["Reflect.apply", f => Reflect.apply(f, null, [])],
  ["Reflect.construct", f => Reflect.construct(f, [])],
  ["Reflect.construct as the new target", f => Reflect.construct(Object, [], f)],
];

const values = [
  ["a function", () => value => value],
  ["undefined", () => undefined],
  ["null", () => null],
  ["a number", () => 5],
  ["a string", () => "$&$&"],
  ["an object", () => ({ handleEvent() { log.push("handled"); }, toString: () => "an object" })],
  ["an array of names", () => ["b"]],
  ["a class", () => class {}],
];

process.on("uncaughtException", error => log.push("uncaught " + error.constructor.name));

async function main() {
  for (const [taker, run] of takers) {
    for (const [name, make] of values) await attempt(taker + " gets " + name, () => run(make()));
  }
}

main();
