// A callback that expects a text is called by built ins.
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

const { EventEmitter } = require("node:events");

const seen = [];

function note(text) {
  let line;
  try {
    line = typeof text + " " + text.length + " " + text.toUpperCase() + " " + (text === "hello") + " " + text.charCodeAt(0);
  } catch (error) {
    line = typeof text + " threw " + error.constructor.name;
  }
  seen.push(line);
  return line;
}

function flush(label) {
  console.log(label + " -> " + seen.splice(0).join(" | "));
}

for (let i = 0; i < 2000; i++) note("hello");
seen.length = 0;

const lookAlike = { length: 2, toUpperCase: () => "LOOK", charCodeAt: () => -1 };
const values = ["hello", new String("hello"), ["h", "i"], lookAlike, 5, null, undefined, Symbol("s")];

async function main() {
  values.forEach(note);
  flush("forEach passes the value, an index and the list");
  values.map(note);
  flush("map");
  values.filter(note);
  flush("filter");
  values.some(value => (note(value), false));
  flush("some");
  values.find(value => (note(value), false));
  flush("find");
  Array.from(values, note);
  flush("Array.from");
  Array.prototype.forEach.call({ length: 2, 0: "hello", 1: lookAlike }, note);
  flush("forEach over an array-like");
  Array.prototype.forEach.call("hi", note);
  flush("forEach over a text");
  new Set(values).forEach(note);
  flush("Set.forEach");
  new Map([["hello", 5], [lookAlike, "hello"]]).forEach(note);
  flush("Map.forEach passes the value first");
  new Map([["hello", 5], [lookAlike, "hello"]]).forEach((value, key) => note(key));
  flush("Map.forEach keys");
  new Uint8Array([104, 105]).forEach(note);
  flush("typed array forEach");
  Buffer.from("hi").forEach(note);
  flush("Buffer forEach");
  new URLSearchParams("a=hello&b=5").forEach(note);
  flush("URLSearchParams.forEach");
  Object.keys({ hello: 1, 5: 2 }).forEach(note);
  flush("Object.keys");
  Object.values({ a: "hello", b: 5, c: lookAlike }).forEach(note);
  flush("Object.values");
  Object.entries({ hello: lookAlike }).forEach(([key, value]) => (note(key), note(value)));
  flush("Object.entries");
  ["b", 5, "a"].sort((a, b) => (note(a), note(b), 0));
  flush("sort");
  values.reduce((ignored, value) => note(value), "start");
  flush("reduce");
  ["hello", 5].reduce(note);
  flush("reduce passes the accumulator first");
  "a-b".replace(/(-)|(x)/, (match, first, second) => (note(match), note(first), note(second), ""));
  flush("replace");
  "hello".replace("hello", note);
  flush("replace calls it directly");
  JSON.parse('{ "hello": "hello", "list": [5] }', (key, value) => (note(key), note(value), value));
  flush("a reviver");
  JSON.stringify({ hello: "hello", list: [5] }, (key, value) => (note(key), value));
  flush("a replacer");
  [..."hi"].forEach(note);
  flush("characters");
  Reflect.apply(note, null, [lookAlike]);
  Reflect.apply(note, null, { length: 1, 0: 5 });
  flush("Reflect.apply");
  new Proxy({}, { get: (target, key) => note(key) })[Symbol.iterator];
  new Proxy({}, { get: (target, key) => note(key) }).hello;
  new Proxy({}, { get: (target, key) => note(key) })[5];
  flush("a Proxy's get trap gets keys");
  Reflect.ownKeys({ hello: 1, 5: 2, [Symbol("s")]: 3 }).forEach(note);
  flush("Reflect.ownKeys");

  const emitter = new EventEmitter();
  emitter.on("text", note);
  for (const value of values) emitter.emit("text", value);
  emitter.emit("text");
  flush("an event emitter");
  emitter.once("once", note);
  emitter.emit("once", lookAlike);
  emitter.emit("once", "hello");
  flush("once");

  const target = new EventTarget();
  target.addEventListener("text", event => note(event.type));
  target.addEventListener("text", event => note(event.detail));
  target.dispatchEvent(new CustomEvent("text", { detail: lookAlike }));
  flush("an event target");

  await new Promise(resolve => process.nextTick((a, b) => (note(a), note(b), resolve()), "hello", lookAlike));
  flush("process.nextTick");
  await new Promise(resolve => setTimeout((a, b) => (note(a), note(b), resolve()), 0, "hello", 5));
  flush("setTimeout");
  await new Promise(resolve => setImmediate((a, b) => (note(a), note(b), resolve()), lookAlike));
  flush("setImmediate");
  await Promise.resolve(lookAlike).then(note);
  await Promise.reject("hello").catch(note);
  await Promise.reject(new RangeError("hello")).catch(error => note(error.message));
  await Promise.resolve("hello").finally(note);
  flush("promise reactions");
  await Promise.all(["hello", Promise.resolve(5), { then: resolve => resolve(lookAlike) }]).then(results => results.forEach(value => note(value)));
  flush("Promise.all");
  (await Promise.allSettled([Promise.reject("hello"), 5])).forEach(result => (note(result.status), note(result.reason), note(result.value)));
  flush("Promise.allSettled");
  note("hello");
  flush("honest again");
}

main();
