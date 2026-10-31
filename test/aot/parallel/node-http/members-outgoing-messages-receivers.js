// Every accessor and every method on the prototype objects of a response, of an outgoing message and of a client's request is entered with receivers that are no such message: plain objects, objects of other classes, copies of a response, heirs of the prototype objects, the prototype objects themselves, a number, and proxies that list their traps. Printed by member: what it answers or throws and which keys it leaves on its receiver, the receivers with one outcome on one line.
const http = require("node:http");
const net = require("node:net");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const lines = [];

const textOfKey = key => (typeof key === "symbol" ? `[${key.description}]` : key);

function textOfValue(value, receiver) {
  if (value === receiver && value !== undefined && value !== null) return "the receiver";
  if (value === null || value === undefined || typeof value === "boolean") return String(value);
  if (typeof value === "function") return `function ${value.name}`;
  if (typeof value !== "object") return typeof value;
  return `object ${Object.getPrototypeOf(value)?.constructor?.name ?? "without a class"}`;
}

function textOfError(error) {
  if (error === null || typeof error !== "object") return `throws ${textOfValue(error)}`;
  // The engine quotes the text of the library in these.
  const message = String(error.message)
    .split("\n")[0]
    .replace(/ \(evaluating '.*$/, "")
    .replace(/^.* is not a (function|constructor).*$/, "what is called is not a $1");
  return `throws ${error.name}${error.code === undefined ? "" : ` ${error.code}`}: ${message}`;
}

let trapped = [];
let isListing = false;
function listing(target) {
  const handler = {};
  for (const trap of ["get", "set", "has", "getOwnPropertyDescriptor", "defineProperty", "deleteProperty"]) {
    handler[trap] = function (target, key) {
      if (isListing) trapped.push(`${trap} ${textOfKey(key)}`);
      return Reflect[trap](...arguments);
    };
  }
  for (const trap of ["getPrototypeOf", "ownKeys", "isExtensible", "preventExtensions"]) {
    handler[trap] = function () {
      if (isListing) trapped.push(trap);
      return Reflect[trap](...arguments);
    };
  }
  return new Proxy(target, handler);
}

const response = () => new http.ServerResponse(new http.IncomingMessage(null));
const copyOf = message => Object.assign(Object.create(Object.getPrototypeOf(message)), message);
class Other {
  own = 1;
}
const receivers = [
  ["{}", () => ({})],
  ["an object without a prototype", () => Object.create(null)],
  ["an instance of another class", () => new Other()],
  ["a frozen object", () => Object.freeze({})],
  ["{ finished: true }", () => ({ finished: true })],
  ["{ destroyed: true }", () => ({ destroyed: true })],
  ["an emitter", () => new EventEmitter()],
  ["a socket", () => new net.Socket()],
  ["an outgoing message", () => new http.OutgoingMessage()],
  ["an incoming message", () => new http.IncomingMessage(null)],
  ["an heir of an outgoing message", () => Object.create(new http.OutgoingMessage())],
  ["an heir of the prototype object", level => Object.create(level)],
  ["the prototype object", level => level],
  ["a spread response", () => ({ ...response() })],
  ["a copy of a response", () => copyOf(response())],
  [
    "a copy of a response with a socket",
    () => {
      const original = response();
      original.assignSocket(new PassThrough());
      return copyOf(original);
    },
  ],
  ["a number", () => 7],
  ["a proxy of {}", () => listing({})],
  ["a proxy of an heir of the prototype object", level => listing(Object.create(level))],
  ["a proxy of a copy of a response", () => listing(copyOf(response()))],
];
const lists = [
  ["()", () => []],
  ['("a", 1)', () => ["a", 1]],
  ['(200, { a: "b" })', () => [200, { a: "b" }]],
  ['("x", "utf8", a function)', () => ["x", "utf8", function callback() {}]],
  ['([["a", "b"]])', () => [[["a", "b"]]]],
];

const ownKeysOf = receiver => (typeof receiver === "object" && receiver !== null ? Reflect.ownKeys(receiver) : []);

function enter(title, level, body) {
  const outcomes = new Map();
  for (const [name, make] of receivers) {
    const before = new Map();
    for (const key of Reflect.ownKeys(level)) before.set(key, Reflect.getOwnPropertyDescriptor(level, key));
    const receiver = make(level);
    const keysBefore = new Set(ownKeysOf(receiver));
    trapped = [];
    isListing = true;
    let outcome;
    try {
      outcome = textOfValue(body(receiver), receiver);
    } catch (error) {
      outcome = textOfError(error);
    }
    isListing = false;
    const seen = trapped;
    const stored = ownKeysOf(receiver).filter(key => !keysBefore.has(key));
    if (stored.length !== 0) outcome += `, stores ${stored.map(textOfKey).join(" ")}`;
    if (seen.length !== 0) outcome += `, traps ${seen.join(", ")}`;
    // The prototype object is left as it was found.
    for (const key of Reflect.ownKeys(level)) if (!before.has(key)) delete level[key];
    for (const [key, descriptor] of before) Object.defineProperty(level, key, descriptor);
    if (outcomes.has(outcome)) outcomes.get(outcome).push(name);
    else outcomes.set(outcome, [name]);
  }
  lines.push(title);
  for (const [outcome, names] of outcomes) lines.push(`  ${outcome} <- ${names.join(", ")}`);
}

process.on("uncaughtException", error => lines.push(`later: ${textOfError(error)}`));

for (const [path, level] of [
  ["ServerResponse.prototype", http.ServerResponse.prototype],
  ["OutgoingMessage.prototype", http.OutgoingMessage.prototype],
  ["ClientRequest.prototype", http.ClientRequest.prototype],
]) {
  for (const key of Reflect.ownKeys(level)) {
    // _deferToConnect() calls what its first argument names with what its second argument lists.
    if (key === "constructor" || key === "_deferToConnect") continue;
    const { get, set, value } = Reflect.getOwnPropertyDescriptor(level, key);
    const title = `${path} ${textOfKey(key)}`;
    if (typeof get === "function") enter(`${title}, read`, level, receiver => get.call(receiver));
    if (typeof set === "function") {
      enter(`${title} = 1`, level, receiver => set.call(receiver, 1));
      enter(`${title} = null`, level, receiver => set.call(receiver, null));
      enter(`${title} = { a: "b" }`, level, receiver => set.call(receiver, { a: "b" }));
    }
    if (typeof value === "function") {
      for (const [name, list] of lists) enter(`${title}${name}`, level, receiver => value.apply(receiver, list()));
    }
  }
}

let turns = 0;
(function turn() {
  if (++turns < 4) return setImmediate(turn);
  process.stdout.write(lines.join("\n") + "\n", () => process.exit(0));
})();
