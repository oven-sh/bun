// Small programs in which one thing is put somewhere, taken out again and used at a place of the program where another thing of its kind arrives too (`corners`: where it is put).
//
//   where      what the language gives a function, an object, a class, a call, an error, a promise, a generator; collections and lists; descriptors, keys of every kind, proxies; the global object; what the host keeps
//              for a timer, an event, an emitter, a signal, a stream; a variable that a module exports, `exports`, what a JSON file holds, the cache of `require`, `import.meta`
//              later (`laterCorners`): what Bun keeps for a socket, a websocket, a server, a database; new members of objects of Bun and of the web; asynchronous contexts, reasons of streams, newer built-ins
//   then       nothing, or a second place that the thing goes through once it is out of the first
//   the thing  (`things`) one of two functions, classes, layouts, instances, keys or names of methods, a text among numbers, a fraction among integers, an object that is changed at the far end, a function that loads
//              modules, that makes functions out of text or that evaluates text, that imports, that starts workers
//   inside     nothing, or something that is put there in its place and holds it: a literal, a list, a closure, a map, a set, an instance, a getter, a prototype, one or two levels deep
//   written    straight, statement behind statement, or as functions that put what they are handed and answer what they take out; the thing where it is put, or under a name
//   the files  one; the place apart; the use apart; every part in a file of its own; ES modules or CommonJS; the program and the use in JavaScript or in TypeScript, over a declaration file, over what TypeScript
//              infers, or unchecked
//   called     a function is called straight, by `call`, `apply`, `bind`, `Reflect.apply`, out of a list, through a proxy, as a getter, as a tag, or by a built-in that is handed it
//   ahead      nothing, or one or two lines that ask `process`, the global object or a built-in module for something
//   beside it  the other thing arrives ahead of it or behind it, once, three times or ten thousand times, or never
//
// TypeScript accepts every program. The executable prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

/** What a place takes: anything, `o` no primitive value, `f` a function that can be called, `c` a constructor. */
type Place = readonly [
  holder: string,
  put: string,
  take: string,
  takes?: "o" | "f" | "c" | "",
  files?: Record<string, string>,
];

const object = "const held = {};";
const plain = "function held() {}";
const seen = "held.seen";
const variable = "export let kept;\nexport function set(value) {\n  kept = value;\n}\n";
const places: Record<string, Place> = {
  "the prototype of a function": [plain, "held.prototype = §;", "held.prototype"],
  "the prototype of a function, in brackets": [plain, `held["prototype"] = §;`, `held["prototype"]`],
  "the prototype of a function, by a pattern": [plain, "held.prototype = §;", "(({ prototype }) => prototype)(held)"],
  "the prototype of a function, off an instance": [
    plain,
    "held.prototype = §;",
    "Object.getPrototypeOf(new held())",
    "o",
  ],
  "the prototype of a function, defined": [
    plain,
    `Object.defineProperty(held, "prototype", { value: § });`,
    "held.prototype",
  ],
  "the constructor on a prototype": [plain, "held.prototype.constructor = §;", "new held().constructor"],
  "a member of a prototype": [plain, "held.prototype.member = §;", "new held().member"],
  "a member of a function": [plain, "held.member = §;", "held.member"],
  "the name of a function": [plain, `Object.defineProperty(held, "name", { value: § });`, "held.name"],
  "the length of a function": [plain, `Object.defineProperty(held, "length", { value: § });`, "held.length"],
  "the prototype of an object": [object, "Object.setPrototypeOf(held, §);", "Object.getPrototypeOf(held)", "o"],
  "__proto__ of an object": [object, "held.__proto__ = §;", "held.__proto__", "o"],
  "__proto__ in a literal": [object, "held.inner = { __proto__: § };", "Object.getPrototypeOf(held.inner)", "o"],
  "the prototype that Object.create is handed": [
    object,
    "held.inner = Object.create(§);",
    "Object.getPrototypeOf(held.inner)",
    "o",
  ],
  "the prototype that Reflect.setPrototypeOf is handed": [
    object,
    "Reflect.setPrototypeOf(held, §);",
    "Reflect.getPrototypeOf(held)",
    "o",
  ],
  "the class above a class": [object, "held.inner = class extends § {};", "Object.getPrototypeOf(held.inner)", "c"],
  "new.target": ["function held() {\n  held.seen = new.target;\n}", "Reflect.construct(held, [], §);", seen, "c"],
  "the constructor of an instance": [object, "held.inner = new §();", "held.inner.constructor", "c"],
  "this of a call": ["function held() {\n  held.seen = this;\n}", "held.call(§);", seen, "o"],
  "this of a bound function": ["function held() {\n  held.seen = this;\n}", "held.bind(§)();", seen, "o"],
  "this of a method": [
    "const held = {\n  method() {\n    held.seen = this.member;\n  },\n};",
    "held.member = §;\nheld.method();",
    seen,
  ],
  "an argument of a bound function": ["function held(given) {\n  held.seen = given;\n}", "held.bind(null, §)();", seen],
  "an argument of apply": ["function held(given) {\n  held.seen = given;\n}", "held.apply(null, [§]);", seen],
  "an argument of Reflect.apply": [
    "function held(given) {\n  held.seen = given;\n}",
    "Reflect.apply(held, null, [§]);",
    seen,
  ],
  "an argument of a spread call": ["function held(first, given) {\n  held.seen = given;\n}", "held(...[0, §]);", seen],
  "arguments": ["function held() {\n  held.seen = arguments[0];\n}", "held(§);", seen],
  "the rest of the arguments": ["function held(...all) {\n  held.seen = all[0];\n}", "held(§);", seen],
  "a pattern in a parameter": ["function held({ member }) {\n  held.seen = member;\n}", "held({ member: § });", seen],
  "the default of a parameter": [object, "(function (given = §) {\n  held.seen = given;\n})();", seen],
  "a value of a tagged template": ["function held(texts, given) {\n  held.seen = given;\n}", "held`a${§}b`;", seen],
  "the cause of an error": [object, `held.error = new Error("", { cause: § });`, "held.error.cause"],
  "the message of an error": [object, `held.error = new Error("");\nheld.error.message = §;`, "held.error.message"],
  "the errors of an AggregateError": [object, "held.error = new AggregateError([§]);", "held.error.errors[0]"],
  "thrown and caught": [object, "try {\n  throw §;\n} catch (caught) {\n  held.seen = caught;\n}", seen],
  "thrown in a function and caught": [
    "function held(given) {\n  throw given;\n}",
    "try {\n  held(§);\n} catch (caught) {\n  held.seen = caught;\n}",
    seen,
  ],
  "returned out of finally": [
    "function held(given) {\n  try {\n    throw 0;\n  } finally {\n    return given;\n  }\n}",
    "held.seen = held(§);",
    seen,
  ],
  "the value of a promise": [object, "held.promise = Promise.resolve(§);", "await held.promise"],
  "the reason of a promise": [
    object,
    "held.promise = Promise.reject(§);",
    "await held.promise.catch(reason => reason)",
  ],
  "what an async function answers": [
    "async function held(given) {\n  return given;\n}",
    "held.promise = held(§);",
    "await held.promise",
  ],
  "what an async function throws": [
    "async function held(given) {\n  throw given;\n}",
    "held.promise = held(§);",
    "await held.promise.then(null, reason => reason)",
  ],
  "Promise.all": [object, "held.promise = Promise.all([0, §]);", "(await held.promise)[1]"],
  "Promise.allSettled": [
    object,
    "held.promise = Promise.allSettled([Promise.reject(§)]);",
    "(await held.promise)[0].reason",
  ],
  "Promise.race": [object, "held.promise = Promise.race([§]);", "await held.promise"],
  "Promise.withResolvers": ["const held = Promise.withResolvers();", "held.resolve(§);", "await held.promise"],
  "what a generator yields": ["function* held(given) {\n  yield given;\n}", "held.seen = held(§).next().value;", seen],
  "what a generator returns": [
    "function* held(given) {\n  return given;\n}",
    "held.seen = held(§).next().value;",
    seen,
  ],
  "what next is handed": [
    "function* held() {\n  held.seen = yield;\n}",
    "held.running = held();\nheld.running.next();\nheld.running.next(§);",
    seen,
  ],
  "what return is handed": ["function* held() {\n  yield 0;\n}", "held.seen = held().return(§).value;", seen],
  "what an async generator yields": [
    "async function* held(given) {\n  yield given;\n}",
    "held.promise = held(§).next();",
    "(await held.promise).value",
  ],
  "the step of an iterator": [object, "held.seen = [§][Symbol.iterator]().next().value;", seen],
  "a loop over a list": [object, "for (const each of [§]) held.seen = each;", seen],
  "an iterator helper": [object, "held.seen = [§]\n  .values()\n  .map(each => each)\n  .next().value;", seen],
  "a value of a map": ["const held = new Map();", `held.set("key", §);`, `held.get("key")`],
  "a key of a map": ["const held = new Map();", "held.set(§, 0);", "[...held.keys()][0]"],
  "a map, in forEach": [
    "const held = new Map();",
    `held.set("key", §);`,
    "(() => {\n  let found;\n  held.forEach(value => (found = value));\n  return found;\n})()",
  ],
  "a member of a set": ["const held = new Set();", "held.add(§);", "[...held][0]"],
  "a value of a weak map": ["const held = new WeakMap();", "held.set(held, §);", "held.get(held)"],
  "a weak reference": [object, "held.reference = new WeakRef(§);", "held.reference.deref()", "o"],
  "pushed and popped": ["const held = [];", "held.push(§);", "held.pop()"],
  "pushed and read by at": ["const held = [];", "held.push(0, §);", "held.at(-1)"],
  "unshifted and shifted": ["const held = [];", "held.unshift(§);", "held.shift()"],
  "an element beyond the end": ["const held = [];", "held[3] = §;", "held[3]"],
  "found in a list": ["const held = [];", "held.push(§);", "held.find(() => true)"],
  "a list that is flattened": ["const held = [];", "held.push([§]);", "held.flat()[0]"],
  "a list that is joined to another": ["const held = [];", "held.push(§);", "[].concat(held)[0]"],
  "a part of a list": ["const held = [];", "held.push(0, §);", "held.slice(1)[0]"],
  "spliced out of a list": ["const held = [];", "held.push(0, §);", "held.splice(1, 1)[0]"],
  "Array.from": [object, "held.list = Array.from({ length: 1, 0: § });", "held.list[0]"],
  "Array.of": [object, "held.list = Array.of(§);", "held.list[0]"],
  "a list that is filled": [object, "held.list = new Array(2).fill(§);", "held.list[1]"],
  "a copy of a list with one element replaced": [object, "held.list = [0].with(0, §);", "held.list[0]"],
  "a sorted copy of a list": [object, "held.list = [§].toSorted(() => 0);", "held.list[0]"],
  "what a comparator is handed": [object, "[§, §].sort(first => {\n  held.seen = first;\n  return 0;\n});", seen],
  "where reduce starts": [object, "held.seen = [].reduce(sum => sum, §);", seen],
  "this of a callback of map": [object, "[0].map(function () {\n  held.seen = this;\n}, §);", seen, "o"],
  "what a callback of map answers": [object, "held.seen = [0].map(() => (§))[0];", seen],
  "a pattern over a list": [object, "[, held.seen] = [0, §];", seen],
  "a pattern over an object": [object, "({ member: held.seen } = { member: § });", seen],
  "the rest of a pattern": [
    object,
    "const { first, ...rest } = { first: 0, member: § };\nheld.seen = rest.member;",
    seen,
  ],
  "a spread object": [object, "held.copy = { ...{ member: § } };", "held.copy.member"],
  "Object.assign": [object, "Object.assign(held, { member: § });", "held.member"],
  "Object.values": [object, "held.member = §;", "Object.values(held)[0]"],
  "Object.entries": [object, "held.member = §;", "Object.entries(held)[0][1]"],
  "Object.fromEntries": [object, `held.made = Object.fromEntries([["member", §]]);`, "held.made.member"],
  "the value of a descriptor": [object, "held.member = §;", `Object.getOwnPropertyDescriptor(held, "member").value`],
  "a member that is defined": [object, `Object.defineProperty(held, "member", { value: § });`, "held.member"],
  "members that are defined": [object, "Object.defineProperties(held, { member: { value: § } });", "held.member"],
  "what a getter answers": [object, `Object.defineProperty(held, "member", { get: () => (§) });`, "held.member"],
  "what a setter is handed": [
    "const held = {\n  set member(given) {\n    held.seen = given;\n  },\n};",
    "held.member = §;",
    seen,
  ],
  "the getter of a descriptor": [
    object,
    `Object.defineProperty(held, "member", { get: § });`,
    `Object.getOwnPropertyDescriptor(held, "member").get`,
    "f",
  ],
  "the getter that __lookupGetter__ finds": [
    object,
    `held.__defineGetter__("member", §);`,
    `held.__lookupGetter__("member")`,
    "f",
  ],
  "a key that is a symbol": [object, `held[Symbol.for("key")] = §;`, `held[Symbol.for("key")]`],
  "a key that is put together": [object, `held[["mem", "ber"].join("")] = §;`, "held.member"],
  "a key that is put together where it is read": [object, "held.member = §;", `held[["mem", "ber"].join("")]`],
  "a key that reads as a number": [object, `held["1"] = §;`, "held[1]"],
  "Reflect.set and Reflect.get": [object, `Reflect.set(held, "member", §);`, `Reflect.get(held, "member")`],
  "a proxy without traps": ["const held = new Proxy({}, {});", "held.member = §;", "held.member"],
  "the target of a proxy": [object, "new Proxy(held, {}).member = §;", "held.member"],
  "what a trap answers": [object, "held.proxy = new Proxy({}, { get: () => (§) });", "held.proxy.member"],
  "a member of the global object": [object, "globalThis.heldByAll = §;", "globalThis.heldByAll"],
  "a member of the global object, read as a name": [object, "globalThis.heldByAll = §;", "heldByAll"],
  "a new member of Array.prototype": [object, "Array.prototype.heldByAll = §;", "[].heldByAll"],
  "a new member of String.prototype": [object, "String.prototype.heldByAll = §;", `"text".heldByAll`],
  "a new member of Number.prototype": [object, "Number.prototype.heldByAll = §;", "(5).heldByAll"],
  "a new member of Map.prototype": [object, "Map.prototype.heldByAll = §;", "new Map().heldByAll"],
  "a new member of Error.prototype": [object, "Error.prototype.heldByAll = §;", `new TypeError("").heldByAll`],
  "a new member of Array": [object, "Array.heldByAll = §;", "Array.heldByAll"],
  "a new member of Array, read off a class below": [object, "Array.heldByAll = §;", "class extends Array {}.heldByAll"],
  "a new member of Math": [object, "Math.heldByAll = §;", "Math.heldByAll"],
  "a new member of JSON": [object, "JSON.heldByAll = §;", "JSON.heldByAll"],
  "a new member of Symbol": [object, "Symbol.heldByAll = §;", "Symbol.heldByAll"],
  "a new member of console": [object, "console.heldByAll = §;", "console.heldByAll"],
  "a new member of process": [object, "process.heldByAll = §;", "process.heldByAll"],
  "a new member of a built-in function": [object, "parseInt.heldByAll = §;", "parseInt.heldByAll"],
  "a new member of a built-in module": [
    object,
    `process.getBuiltinModule("node:path").heldByAll = §;`,
    `process.getBuiltinModule("node:path").heldByAll`,
  ],
  "a static field": ["class held {\n  static member;\n}", "held.member = §;", "held.member"],
  "a private field": [
    "class held {\n  static #member;\n  static put(given) {\n    held.#member = given;\n  }\n  static take() {\n    return held.#member;\n  }\n}",
    "held.put(§);",
    "held.take()",
  ],
  "a field of an instance": [
    "class held {\n  static last;\n  member;\n  constructor(given) {\n    this.member = given;\n    held.last = this;\n  }\n}",
    "new held(§);",
    "held.last.member",
  ],
  "what a constructor answers": ["function held(given) {\n  return given;\n}", "held.seen = new held(§);", seen, "o"],
  "a variable of a closure": [
    "const held = (() => {\n  let kept;\n  return { put: given => void (kept = given), take: () => kept };\n})();",
    "held.put(§);",
    "held.take()",
  ],
  "what a reviver answers": [object, `held.seen = JSON.parse("0", () => (§));`, seen],
  "a comma, a condition and a fallback": [object, "held.seen = (0, held.nothing ?? (held.nothing ? 0 : §));", seen],
  "an argument of a timer": [
    object,
    "await new Promise(done =>\n  setTimeout(\n    given => {\n      held.seen = given;\n      done();\n    },\n    0,\n    §,\n  ),\n);",
    seen,
  ],
  "an argument of nextTick": [
    object,
    "await new Promise(done =>\n  process.nextTick(given => {\n    held.seen = given;\n    done();\n  }, §),\n);",
    seen,
  ],
  "the reason of a signal": ["const held = new AbortController();", "held.abort(§);", "held.signal.reason"],
  "the detail of an event": [object, `held.event = new CustomEvent("event", { detail: § });`, "held.event.detail"],
  "the detail of an event, in a listener": [
    "const held = new EventTarget();",
    `held.addEventListener("event", event => {\n  held.seen = event.detail;\n});\nheld.dispatchEvent(new CustomEvent("event", { detail: § }));`,
    seen,
  ],
  "a member of an event": [object, `held.event = new Event("event");\nheld.event.member = §;`, "held.event.member"],
  "an argument of an emitter": [
    'const held = new (process.getBuiltinModule("node:events"))();',
    `held.on("event", given => {\n  held.seen = given;\n});\nheld.emit("event", §);`,
    seen,
  ],
  "the listeners of an emitter": [
    'const held = new (process.getBuiltinModule("node:events"))();',
    `held.on("event", §);`,
    `held.listeners("event")[0]`,
    "f",
  ],
  "a chunk of a stream": [
    object,
    "held.stream = new ReadableStream({\n  start(controller) {\n    controller.enqueue(§);\n    controller.close();\n  },\n});",
    "(await held.stream.getReader().read()).value",
  ],
  "a variable that a module exports": [
    `import * as held from "./module.mjs";`,
    "held.set(§);",
    "held.kept",
    "",
    { "module.mjs": variable },
  ],
  "a variable that a module exports, under a key that is put together": [
    `import * as held from "./module.mjs";`,
    "held.set(§);",
    `held[["ke", "pt"].join("")]`,
    "",
    { "module.mjs": variable },
  ],
  "a variable that a module exports, in a copy of the namespace": [
    `import * as held from "./module.mjs";`,
    "held.set(§);",
    "{ ...held }.kept",
    "",
    { "module.mjs": variable },
  ],
  "a variable that a module exports, through a file that hands it on": [
    `import * as held from "./hands.mjs";`,
    "held.set(§);",
    "held.kept",
    "",
    { "module.mjs": variable, "hands.mjs": `export * from "./module.mjs";\n` },
  ],
  "a variable that a module exports, asked for by import()": [
    `import * as held from "./module.mjs";`,
    "held.set(§);",
    `(await import("./module.mjs")).kept`,
    "",
    { "module.mjs": variable },
  ],
  "a variable that a module exports, asked for by require": [
    `import * as held from "./module.mjs";`,
    "held.set(§);",
    `require("./module.mjs").kept`,
    "",
    { "module.mjs": variable },
  ],
  "a member of the default of a module": [
    `import held from "./module.mjs";`,
    "held.kept = §;",
    "held.kept",
    "",
    { "module.mjs": "const box = {};\nexport default box;\n" },
  ],
  "a member of exports": [
    `const held = require("./module.cjs");`,
    "held.kept = §;",
    `require("./module.cjs").kept`,
    "",
    { "module.cjs": "exports.kept = undefined;\n" },
  ],
  "a member of exports, asked for by import()": [
    `const held = require("./module.cjs");`,
    "held.kept = §;",
    `(await import("./module.cjs")).default.kept`,
    "",
    { "module.cjs": "exports.other = 0;\n" },
  ],
  "a member of a function that is module.exports": [
    `const held = require("./module.cjs");`,
    "held(§);",
    "held.kept",
    "",
    { "module.cjs": "module.exports = function set(value) {\n  module.exports.kept = value;\n};\n" },
  ],
  "a member of this at the top of a CommonJS file": [
    `const held = require("./module.cjs");`,
    "held.set(§);",
    "held.kept",
    "",
    { "module.cjs": "this.set = value => {\n  this.kept = value;\n};\n" },
  ],
  "a member of what a JSON file holds": [
    `const held = require("./data.json");`,
    "held.kept = §;",
    `require("./data.json").kept`,
    "",
    { "data.json": `{ "kept": null }\n` },
  ],
  "the cache of require": [
    `const held = require("./module.cjs");`,
    "held.kept = §;",
    `require.cache[require.resolve("./module.cjs")].exports.kept`,
    "",
    { "module.cjs": "exports.other = 0;\n" },
  ],
  "a member of import.meta": ["const held = import.meta;", "held.kept = §;", "held.kept"],
};
export const corners = Object.keys(places);

/** Places that came later: objects of Bun and of the host, and newer places of the language. They have rows of their own in the test, behind the rows of the others. */
const database = 'import { Database } from "bun:sqlite";\nconst held = new Database(":memory:");';
const storage = 'const held = new (process.getBuiltinModule("node:async_hooks").AsyncLocalStorage)();';
const later: Record<string, Place> = {
  "the data of a socket that Bun listens on": [
    object,
    'await new Promise(done => {\n  const server = Bun.listen({\n    hostname: "127.0.0.1",\n    port: 0,\n    data: §,\n    socket: {\n      open(socket) {\n        held.seen = socket.data;\n        socket.end();\n        server.stop(true);\n        done();\n      },\n      data() {},\n    },\n  });\n  Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {}, error() {} } });\n});',
    seen,
  ],
  "the data of a socket that Bun connects": [
    object,
    'await new Promise(done => {\n  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });\n  Bun.connect({\n    hostname: "127.0.0.1",\n    port: server.port,\n    data: §,\n    socket: {\n      open(socket) {\n        held.seen = socket.data;\n        socket.end();\n        server.stop(true);\n        done();\n      },\n      data() {},\n      error() {},\n    },\n  });\n});',
    seen,
  ],
  "the data of a socket of Bun, stored later": [
    object,
    'await new Promise(done => {\n  const server = Bun.listen({\n    hostname: "127.0.0.1",\n    port: 0,\n    socket: {\n      open(socket) {\n        socket.data = §;\n        socket.end();\n      },\n      close(socket) {\n        held.seen = socket.data;\n        server.stop(true);\n        done();\n      },\n      data() {},\n    },\n  });\n  Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {}, error() {} } });\n});',
    seen,
  ],
  "the data of a websocket of a server of Bun": [
    object,
    'await new Promise(done => {\n  const server = Bun.serve({\n    hostname: "127.0.0.1",\n    port: 0,\n    fetch(request, server) {\n      return server.upgrade(request, { data: § }) ? undefined : new Response("no");\n    },\n    websocket: {\n      open(socket) {\n        held.seen = socket.data;\n        socket.close();\n        server.stop(true);\n        done();\n      },\n      message() {},\n    },\n  });\n  new WebSocket(`ws://127.0.0.1:${server.port}/`);\n});',
    seen,
  ],
  "thrown in the handler of a server of Bun": [
    object,
    'const server = Bun.serve({\n  hostname: "127.0.0.1",\n  port: 0,\n  fetch() {\n    throw §;\n  },\n  error(thrown) {\n    held.seen = thrown;\n    return new Response("caught");\n  },\n});\nawait (await fetch(`http://127.0.0.1:${server.port}/`)).text();\nawait server.stop(true);',
    seen,
  ],
  "Bun.peek": [object, "held.promise = Promise.resolve(§);", "Bun.peek(held.promise)"],
  "Bun.readableStreamToArray": [
    object,
    "held.stream = new ReadableStream({\n  start(controller) {\n    controller.enqueue(§);\n    controller.close();\n  },\n});",
    "(await Bun.readableStreamToArray(held.stream))[0]",
  ],
  "a new member of a file of Bun": ['const held = Bun.file("nowhere.txt");', "held.member = §;", "held.member"],
  "a new member of a response": ['const held = new Response("");', "held.member = §;", "held.member"],
  "a new member of a request": ['const held = new Request("http://localhost/");', "held.member = §;", "held.member"],
  "a new member of headers": ["const held = new Headers();", "held.member = §;", "held.member"],
  "a new member of a blob": ["const held = new Blob([]);", "held.member = §;", "held.member"],
  "a new member of an address": ['const held = new URL("http://localhost/");', "held.member = §;", "held.member"],
  "a new member of a buffer of node": ["const held = Buffer.alloc(1);", "held.member = §;", "held.member"],
  "a new member of Bun": ["const held = Bun;", "held.memberOfTheProgram = §;", "held.memberOfTheProgram"],
  "the class that the rows of a database become": [
    database,
    'held.rows = held.query("select 1 as a").as(§);',
    "held.rows.get().constructor",
    "c",
  ],
  "a transaction of a database": [database, "held.run = held.transaction(§);", "held.run", "f"],
  "the store of an AsyncLocalStorage": [storage, "held.enterWith(§);", "held.getStore()"],
  "the store of an AsyncLocalStorage, in run": [storage, "held.seen = held.run(§, () => held.getStore());", seen],
  "the store of an AsyncLocalStorage, behind an await": [
    storage,
    "held.seen = await held.run(§, async () => {\n  await null;\n  return held.getStore();\n});",
    seen,
  ],
  "a function bound to an asynchronous context": [
    object,
    'held.run = process.getBuiltinModule("node:async_hooks").AsyncLocalStorage.bind(§);',
    "held.run",
    "f",
  ],
  "the reason of a signal that follows another": [
    object,
    "held.signal = AbortSignal.any([AbortSignal.abort(§)]);",
    "held.signal.reason",
  ],
  "what a signal throws": [
    object,
    "try {\n  AbortSignal.abort(§).throwIfAborted();\n} catch (thrown) {\n  held.seen = thrown;\n}",
    seen,
  ],
  "the reason a stream is cancelled for": [
    object,
    "await new ReadableStream({\n  cancel(reason) {\n    held.seen = reason;\n  },\n}).cancel(§);",
    seen,
  ],
  "the reason a stream is aborted for": [
    object,
    "await new WritableStream({\n  abort(reason) {\n    held.seen = reason;\n  },\n}).abort(§);",
    seen,
  ],
  "what a stream that changes nothing passes on": [
    "const held = new TransformStream();",
    "held.writable.getWriter().write(§);",
    "(await held.readable.getReader().read()).value",
  ],
  "a chunk of a stream of node": [
    'const held = new (process.getBuiltinModule("node:stream").PassThrough)({ objectMode: true });',
    "held.write(§);",
    "held.read()",
    "o",
  ],
  "what events.once answers": [
    'const held = new (process.getBuiltinModule("node:events"))();',
    'held.promise = process.getBuiltinModule("node:events").once(held, "event");\nheld.emit("event", §);',
    "(await held.promise)[0]",
  ],
  "what a promisified function answers": [
    object,
    'held.promise = process.getBuiltinModule("node:util").promisify(done => done(null, §))();',
    "await held.promise",
  ],
  "what a timer of node:timers/promises answers": [
    object,
    'held.promise = process.getBuiltinModule("node:timers/promises").setTimeout(0, §);',
    "await held.promise",
  ],
  "an argument of setImmediate": [
    object,
    "await new Promise(done =>\n  setImmediate(given => {\n    held.seen = given;\n    done();\n  }, §),\n);",
    seen,
  ],
  "the data of a message event": [object, 'held.event = new MessageEvent("message", { data: § });', "held.event.data"],
  "the error of an error event": [object, 'held.event = new ErrorEvent("error", { error: § });', "held.event.error"],
  "an argument of an event of process": [
    object,
    'process.once("handed", given => {\n  held.seen = given;\n});\nprocess.emit("handed", §);',
    seen,
  ],
  "what a channel of diagnostics publishes": [
    'const held = process.getBuiltinModule("node:diagnostics_channel").channel("handed");',
    "held.subscribe(message => {\n  held.seen = message;\n});\nheld.publish(§);",
    seen,
  ],
  "what prepareStackTrace answers": [
    object,
    'Error.prepareStackTrace = () => (§);\nheld.seen = new Error("asked").stack;\nError.prepareStackTrace = undefined;',
    seen,
  ],
  "what a stack of disposables hands back": [
    object,
    "{\n  const stack = new DisposableStack();\n  stack.adopt(§, given => {\n    held.seen = given;\n  });\n  stack.dispose();\n}",
    seen,
  ],
  "the error of a SuppressedError": [object, "held.error = new SuppressedError(§, 0);", "held.error.error"],
  "Array.fromAsync": [object, "held.promise = Array.fromAsync([§]);", "(await held.promise)[0]"],
  "Object.groupBy": [object, 'held.groups = Object.groupBy([§], () => "all");', "held.groups.all[0]"],
  "Map.groupBy": [object, "held.groups = Map.groupBy([§], () => 0);", "held.groups.get(0)[0]"],
  "Promise.try": [object, "held.promise = Promise.try(() => (§));", "await held.promise"],
  "Promise.any": [object, "held.promise = Promise.any([§]);", "await held.promise"],
  "Iterator.from": [
    object,
    "held.steps = Iterator.from({\n  next() {\n    return { value: §, done: false };\n  },\n});",
    "held.steps.next().value",
  ],
};
export const laterCorners = Object.keys(later);
Object.assign(places, later);

type Thing = {
  /** Declarations of `First` and `Second`, which the things or their use need, and what a declaration file says of `First`. */
  ahead?: string;
  first?: string;
  odd: readonly string[];
  honest: string;
  type: string;
  use: string;
  kind: "a function" | "a constructor" | "an object" | "a primitive value";
  /** Its use waits for something. */
  isAwaited?: true;
  /** A file that its use starts as a worker. */
  worker?: string;
};
const modules = [
  "async_hooks",
  "zlib",
  "dns",
  "readline",
  "string_decoder",
  "querystring",
  "v8",
  "perf_hooks",
  "assert",
];
const all: Record<string, Thing> = {
  "two functions": {
    // The first one can also be constructed.
    odd: [
      "function () {\n  return 1;\n}",
      "function () {\n  return 1;\n}",
      "function () {\n  return 1;\n}.bind(null)",
      "new Proxy(function () {\n  return 1;\n}, {})",
      "Object.assign(() => 1, { member: 0 })",
      "{\n  method() {\n    return 1;\n  },\n}.method",
      "(one => () => one)(1)",
    ],
    honest: "() => 2",
    type: "(...given: any[]) => any",
    use: "§()",
    kind: "a function",
  },
  "two classes": {
    odd: ["class {\n  tag() {\n    return 1;\n  }\n}"],
    honest: "class {\n  tag() {\n    return 2;\n  }\n}",
    type: "new () => { tag(): number }",
    use: "new §().tag()",
    kind: "a constructor",
  },
  "two layouts": {
    odd: ["{ b: 0, a: 1 }", "{ a: 1.5 }", `{ a: "1" }`],
    honest: "{ a: 2 }",
    type: "{ a: number }",
    use: "§.a",
    kind: "an object",
  },
  "instances of two classes": {
    ahead: "class First {\n  tag() {\n    return 1;\n  }\n}\nclass Second {\n  tag() {\n    return 2;\n  }\n}",
    odd: ["new First()"],
    honest: "new Second()",
    type: "{ tag(): number }",
    use: "§.tag()",
    kind: "an object",
  },
  "a text among numbers": { odd: [`"1"`], honest: "2", type: "number", use: "§ + 1", kind: "a primitive value" },
  "a fraction among integers": {
    odd: ["1.5", "-0", "2 ** 31"],
    honest: "2",
    type: "number",
    use: "§ + 1",
    kind: "a primitive value",
  },
  "an object that is changed": {
    odd: ["{ a: 1 }"],
    honest: "{ a: 2 }",
    type: "{ a: number }",
    use: "(§.a += 4)",
    kind: "an object",
  },
  "two keys": {
    ahead: "const First = { a: 2, b: 1, c: 3 };\nconst Second = 0;",
    first: "export declare const First: { a: number; b: number; c: number };\n",
    odd: [`"b"`, `["b"].join("")`],
    honest: `"a"`,
    type: `"a" | "b"`,
    use: "First[§]",
    kind: "a primitive value",
  },
  "two names of methods": {
    ahead:
      "class First {\n  a() {\n    return 2;\n  }\n  b() {\n    return 1;\n  }\n  c() {\n    return 3;\n  }\n}\nconst Second = 0;",
    first: "export declare class First {\n  a(): number;\n  b(): number;\n  c(): number;\n}\n",
    odd: [`"b"`, `["b"].join("")`],
    honest: `"a"`,
    type: `"a" | "b"`,
    use: "new First()[§]()",
    kind: "a primitive value",
  },
  "two names of members of process": {
    odd: [`"hrtime"`, `"memoryUsage"`, `"cpuUsage"`, `"uptime"`, `"emitWarning"`, `"getBuiltinModule"`],
    honest: `"cwd"`,
    type: "string",
    use: "typeof Reflect.get(process, §)",
    kind: "a primitive value",
  },
  "a function that loads modules": {
    odd: [
      "require",
      "import.meta.require",
      "process.getBuiltinModule",
      "process.getBuiltinModule.bind(process)",
      "name => require(name)",
      "name => process.getBuiltinModule(name)",
      `process.getBuiltinModule("node:module").createRequire(import.meta.url)`,
    ],
    honest: "name => ({ name })",
    type: "(name: string) => object",
    use: `Object.keys(§(["node:", "%"].join(""))).length > 1`,
    kind: "a function",
  },
  "the constructor of functions": {
    odd: ["Function", "function () {}.constructor", "globalThis.Function", 'Reflect.get(globalThis, "Function")'],
    honest: "() => () => 2",
    type: "(text: string) => Function",
    use: `§("return 1")()`,
    kind: "a function",
  },
  "the function that evaluates text": {
    odd: ["eval", "globalThis.eval"],
    honest: "() => 2",
    type: "(text: string) => unknown",
    use: `§("1")`,
    kind: "a function",
  },
  "what node:vm runs text with": {
    odd: [
      `process.getBuiltinModule("node:vm").runInThisContext`,
      `process.getBuiltinModule("node:vm").runInNewContext`,
    ],
    honest: "() => 2",
    type: "(text: string) => unknown",
    use: `§("1")`,
    kind: "a function",
  },
  "the constructor of generator functions": {
    odd: ["Object.getPrototypeOf(function* () {}).constructor"],
    honest: "() => () => [2].values()",
    type: "(text: string) => Function",
    use: `§("yield 1")().next().value`,
    kind: "a function",
  },
  "a function that imports": {
    odd: [
      "name => import(name)",
      "async name => await import(name)",
      "name => import(name).then(all => all)",
      "name => Promise.resolve(name).then(late => import(late))",
    ],
    honest: "async name => ({ name, other: 1 })",
    type: "(name: string) => Promise<object>",
    use: `Object.keys(await §(["node:", "%"].join(""))).length > 1`,
    kind: "a function",
    isAwaited: true,
  },
  "the constructor of asynchronous functions": {
    odd: ["Object.getPrototypeOf(async function () {}).constructor", "async function () {}.constructor"],
    honest: "() => async () => 2",
    type: "(text: string) => Function",
    use: `await §("return 1")()`,
    kind: "a function",
    isAwaited: true,
  },
  "the constructor of asynchronous generator functions": {
    odd: ["Object.getPrototypeOf(async function* () {}).constructor"],
    honest: "() =>\n  async function* () {\n    yield 2;\n  }",
    type: "(text: string) => Function",
    use: `(await §("yield 1")().next()).value`,
    kind: "a function",
    isAwaited: true,
  },
  "a function that starts workers": {
    odd: [
      "file => new Worker(file)",
      "file => new globalThis.Worker(file)",
      "file => Reflect.construct(Worker, [file])",
      "(...given) => new Worker(...given)",
      `file => new (Reflect.get(globalThis, "Worker"))(file)`,
    ],
    honest:
      "() => ({\n  addEventListener(name, listener) {\n    queueMicrotask(() => listener({ data: 2 }));\n  },\n  terminate() {},\n})",
    type: "(file: string) => {\n  addEventListener(name: string, listener: (event: { data: unknown }) => void): void;\n  terminate(): void;\n}",
    use: `await new Promise(resolve => {\n    const worker = §("./works.mjs");\n    worker.addEventListener("message", event => {\n      worker.terminate();\n      resolve(event.data);\n    });\n  })`,
    kind: "a function",
    isAwaited: true,
    worker: "postMessage(1);\n",
  },
  "a function that starts workers of node": {
    odd: [
      `file => new (process.getBuiltinModule("node:worker_threads").Worker)(file)`,
      `file => Reflect.construct(process.getBuiltinModule("node:worker_threads").Worker, [file])`,
      `file => new (Reflect.get(require("node:worker_threads"), "Worker"))(file)`,
    ],
    honest: "() => ({\n  once(name, listener) {\n    queueMicrotask(() => listener(2));\n  },\n})",
    type: "(file: string) => { once(name: string, listener: (message: unknown) => void): unknown }",
    use: `await new Promise(resolve => §("./works.mjs").once("message", resolve))`,
    kind: "a function",
    isAwaited: true,
    worker: `process.getBuiltinModule("node:worker_threads").parentPort.postMessage(1);\n`,
  },
};
/** Things that came later: they have rows of their own in the test, behind the rows of the others. */
export const laterThings = [
  "the constructor of functions",
  "the function that evaluates text",
  "what node:vm runs text with",
  "the constructor of generator functions",
  "a function that imports",
  "the constructor of asynchronous functions",
  "the constructor of asynchronous generator functions",
  "a function that starts workers",
  "a function that starts workers of node",
];
export const things = Object.keys(all).filter(name => !laterThings.includes(name));

/** What holds the thing where it is put, and how the thing is taken out of that. */
const carriers = [
  ["{ inner: § }", "§.inner"],
  ["[§]", "§[0]"],
  ["() => §", "§()"],
  ["new Map([[0, §]])", "§.get(0)"],
  ["new Set([§])", "[...§][0]"],
  ["Object.freeze({ inner: § })", "§.inner"],
  ["{\n  get inner() {\n    return §;\n  },\n}", "§.inner"],
  ["Object.create({ inner: § })", "§.inner"],
  ["new (class {\n  inner = §;\n})()", "§.inner"],
  ["[[§]]", "§[0][0]"],
  ["{ first: { second: § } }", "§.first.second"],
] as const;

/** How one of the two functions is called. */
const waysToCall = [
  "§()",
  "§()",
  "§.call(null)",
  "§.apply(null, [])",
  "§.bind(null)()",
  "Reflect.apply(§, null, [])",
  "Function.prototype.call.call(§, null)",
  "[§][0]()",
  "§?.()",
  "new Proxy(§, {})()",
  "[0].map(§)[0]",
  "Array.from({ length: 1 }, §)[0]",
  "[0].reduce(§, 0)",
  `Reflect.get(Object.defineProperty({}, "member", { get: § }), "member")`,
  "§``",
  `JSON.parse("0", §)`,
  `"a".replace("a", §)`,
];

/** The things that a place takes. */
export function thingsOf(corner: string): string[] {
  const takes = places[corner][3];
  return things.filter(name => {
    const { kind } = all[name];
    if (takes === "f") return kind === "a function";
    if (takes === "c") return kind === "a constructor" || name === "two functions";
    return takes !== "o" || kind !== "a primitive value";
  });
}

/** The thing that a place meets in a row of the test: its own things in turn, and from the twelfth row on the later things, where it takes functions. */
const inRow = (corner: string, row: number) => {
  const takes = thingsOf(corner);
  return row >= 11 && takes.includes("a function that loads modules")
    ? laterThings[row - 11]
    : takes[row % takes.length];
};
const rows = 11 + laterThings.length;
/** A place that can stand in a function behind another place. */
const canFollow = [...corners, ...laterCorners].filter(
  corner => !places[corner][4] && !/\b(import|export) /.test(places[corner][0]),
);
/**
 * What each fixed seed of the test takes: every place of the first kind in every row, then every later place in every row, then every place twice with another place behind it, through which
 * goes a thing that both take.
 */
export const drawn: { corner: string; thing: string; then?: string }[] = [
  ...Array.from({ length: corners.length * rows }, (_, index) => {
    const corner = corners[index % corners.length];
    return { corner, thing: inRow(corner, Math.floor(index / corners.length)) };
  }),
  ...Array.from({ length: laterCorners.length * rows }, (_, index) => {
    const corner = laterCorners[index % laterCorners.length];
    return { corner, thing: inRow(corner, Math.floor(index / laterCorners.length)) };
  }),
  ...[0, 1].flatMap(turn =>
    [...corners, ...laterCorners].map((corner, at) => {
      const then = canFollow[(at * 7 + turn * 53 + 11) % canFollow.length];
      const both = Array.from({ length: rows }, (_, row) => inRow(corner, row)).filter(thing =>
        Array.from({ length: rows }, (_, row) => inRow(then, row)).includes(thing),
      );
      return { corner, thing: both[(at + turn * 5) % both.length], then };
    }),
  ),
];

type Unit = { text: string; defines: string[]; needs: string[] };

export function generate(
  random: Random,
  corner: string,
  wanted?: string,
  then?: string,
): { file: string; text: string; files: Record<string, string>; entryPoints?: string[] } {
  // The relations first.
  const [holder, putsBare, takesBare, accepts, besides] = places[corner];
  const name = wanted ?? random.pick(thingsOf(corner));
  const thing = all[name];
  const next = then === undefined ? undefined : places[then];
  const isAsync = [putsBare, takesBare, ...(next ? [next[1], next[2]] : [])].some(each => each.includes("await"));
  const isChanged = name === "an object that is changed";
  const isStraight = random.chance(0.6);
  const isNamed = isChanged || !isStraight || random.chance(0.3);
  const isHonestNamed = random.chance(0.3);
  const split = random.weighted([
    [3, "one file"],
    [2, "the place apart"],
    [2, "the use apart"],
    [3, "every part apart"],
  ] as const);
  const odd = accepts === "c" ? random.pick(thing.odd.slice(0, 1)) : random.pick(thing.odd);
  const waits = thing.isAwaited ? "await " : "";
  const isCommonJS =
    !waits && !isAsync && !odd.includes("import.meta") && !holder.includes("import") && random.chance(0.25);
  // What puts and takes is written as JavaScript: where it stands in a file of TypeScript, that file is not checked.
  const isApart = split === "the place apart" || split === "every part apart";
  const language = random.weighted([
    [4, "JavaScript"],
    [isCommonJS || !isApart ? 0 : 3, "a declaration file"],
    [isCommonJS || !isApart ? 0 : 3, "inferred"],
    [isCommonJS ? 0 : isApart ? 2 : 5, "unchecked"],
  ] as const);
  const honestCalls = random.pick([0, 1, 1, 3, 10000]);
  const called = random.pick(waysToCall);
  const isAsked = random.chance(0.5);
  const order = random.pick(["ahead", "behind", "round"] as const);
  const isInAFunction = random.chance(0.3);
  const loaded = random.pick(modules);

  const carrier = accepts !== "f" && accepts !== "c" && random.chance(0.35) ? random.pick(carriers) : undefined;

  const asksAhead = random.chance(0.3) ? random.sample([0, 1, 2, 3, 4], random.between(1, 2)).sort() : [];

  const isTyped = language !== "JavaScript";
  const put = carrier ? putsBare.replaceAll("§", `(${carrier[0].replaceAll("§", "(§)")})`) : putsBare;
  const taker = carrier ? carrier[1].replaceAll("§", `(${takesBare})`) : takesBare;
  // What was taken out of the first place goes through the second one, which stands in a function of its own.
  const through = next
    ? `${isAsync ? "async " : ""}function through(value) {\n${next[0]}\n${next[1].replaceAll("§", "value")}\nreturn ${next[2]};\n}\n`
    : "";
  const take = next ? `${isAsync ? "await " : ""}through(${taker})` : taker;
  const use =
    name === "two functions"
      ? isAsked
        ? `typeof § === "function" ? ${called} : typeof §`
        : called
      : thing.use.replaceAll("%", loaded);
  const written = isNamed ? "odd" : odd;
  const of = (text: string, value: string) => text.replaceAll("§", value);
  const first: Unit = {
    text: asksAhead
      .map(
        at =>
          [
            `const read = (holder${isTyped ? ": object" : ""}, key${isTyped ? ": string" : ""}) => typeof Reflect.get(holder, key);\nconsole.log(read(process, "loadEnvFile"));`,
            `require("node:util");`,
            `console.log(typeof process.getBuiltinModule("node:events"));`,
            `console.log(Object.keys(globalThis).length > 0);`,
            `console.log(typeof Reflect.get(globalThis, "process"));`,
          ][at],
      )
      .join("\n"),
    defines: [],
    needs: [],
  };
  const ahead: Unit = { text: thing.ahead ?? "", defines: thing.ahead ? ["First", "Second"] : [], needs: [] };
  const held: Unit = { text: holder, defines: ["held"], needs: [] };
  const named = `const odd${isTyped && !isStraight && odd.includes("=>") ? `: ${thing.type}` : ""} = ${odd};`;
  const puts: Unit = isStraight
    ? {
        text: `${isNamed ? named + "\n" : ""}${of(put, written)}`,
        defines: isNamed ? ["odd"] : [],
        needs: ["held", ...ahead.defines],
      }
    : {
        text: `${isAsync ? "async " : ""}function put(value) {\n${of(put, "value")}\n}`,
        defines: ["put"],
        needs: ["held"],
      };
  const takes: Unit = isStraight
    ? { text: `${through}const taken = ${take};`, defines: ["taken"], needs: ["held"] }
    : {
        text: `${through}${isAsync ? "async " : ""}function take() {\n  return ${take};\n}`,
        defines: ["take"],
        needs: ["held"],
      };
  const uses: Unit = {
    text: `${waits && "async "}function use(given${isTyped ? `: ${thing.type}` : ""}) {\n  return ${of(use, "given")};\n}`,
    defines: ["use"],
    needs: use.includes("First") ? ["First"] : [],
  };
  const honest = isHonestNamed ? "honest" : thing.honest;
  const honestly =
    honestCalls === 0
      ? ""
      : honestCalls === 1
        ? `console.log("the other", ${waits}use(${honest}));\n`
        : `{\n  let last;\n  for (let turn = 0; turn < ${honestCalls}; turn++) last = ${waits}use(${honest});\n  console.log("the other", last);\n}\n`;
  const oddly =
    (isStraight
      ? ""
      : `${named}\n${isAsync ? "await " : ""}put(odd);\nconst taken = ${isAsync ? "await " : ""}take();\n`) +
    `${language === "inferred" ? "// @ts-ignore\n" : ""}console.log("taken out", ${waits}use(taken));\n` +
    (isChanged ? `console.log("where it was made", odd.a);\n` : "");
  const body =
    (isHonestNamed ? `const honest${isTyped ? `: ${thing.type}` : ""} = ${thing.honest};\n` : "") +
    (order === "ahead" ? honestly + oddly : order === "behind" ? oddly + honestly : honestly + oddly + honestly);
  const calls: Unit = {
    text: isInAFunction
      ? `${waits || (isAsync && !isStraight) ? "async " : ""}function run() {\n${body}}\n${waits || (isAsync && !isStraight) ? "await " : ""}run();`
      : body.trimEnd(),
    defines: [],
    needs: ["use", ...(isStraight ? ["taken", ...(isChanged ? ["odd"] : [])] : ["put", "take"]), ...ahead.defines],
  };

  // Which part stands in which file. What is written in JavaScript whatever the program is written in comes first.
  const script = isCommonJS ? "cjs" : "mjs";
  const typed = isTyped ? "ts" : script;
  const laid: [string, Unit[]][] =
    split === "one file"
      ? [[`main.${typed}`, [first, ahead, held, puts, takes, uses, calls]]]
      : split === "the place apart"
        ? [
            [`place.${script}`, [ahead, held, puts, takes]],
            [`main.${typed}`, [first, uses, calls]],
          ]
        : split === "the use apart"
          ? [
              [`uses.${typed}`, uses.needs.length ? [ahead, uses] : [uses]],
              [
                `main.${typed}`,
                uses.needs.length ? [first, held, puts, takes, calls] : [first, ahead, held, puts, takes, calls],
              ],
            ]
          : [
              [`ahead.${script}`, [ahead]],
              [`holder.${script}`, [held]],
              [`puts.${script}`, [puts]],
              [`takes.${script}`, [takes]],
              [`uses.${typed}`, [uses]],
              [`main.${typed}`, [first, calls]],
            ];
  const files: Record<string, string> = { ...besides, ...(thing.worker && { "works.mjs": thing.worker }) };
  const present = laid.filter(([, units]) => units.some(unit => unit.text));
  const types: Record<string, string> = {
    First: thing.first ?? "export declare class First {\n  tag(): number;\n}\n",
    Second: "export declare class Second {\n  tag(): number;\n}\n",
    held: "export declare const held: any;\n",
    odd: `export declare const odd: ${thing.type};\n`,
    taken: `export declare const taken: ${thing.type};\n`,
    put: `export declare function put(value: unknown): ${isAsync ? "Promise<void>" : "void"};\n`,
    take: `export declare function take(): ${isAsync ? `Promise<${thing.type}>` : thing.type};\n`,
  };
  for (const [file, units] of present) {
    const own = units.flatMap(unit => unit.defines);
    const needed = [...new Set(units.flatMap(unit => unit.needs))].filter(each => !own.includes(each));
    // The program names every other file, in the order in which the parts are written; another file names those that it takes something from.
    const isMain = file.startsWith("main.");
    const isScript = file.endsWith("js");
    const lines = present
      .filter(([other]) => other !== file)
      .map(([other, theirs]) => {
        const taken = theirs.flatMap(unit => unit.defines).filter(each => needed.includes(each));
        if (!taken.length && !isMain) return "";
        const from = `"./${other.endsWith(".ts") ? other.slice(0, -3) : other}"`;
        if (isCommonJS && isScript)
          return taken.length ? `const { ${taken.join(", ")} } = require(${from});\n` : `require(${from});\n`;
        return taken.length ? `import { ${taken.join(", ")} } from ${from};\n` : `import ${from};\n`;
      })
      .join("");
    const wantedElsewhere = own.filter(each =>
      present.some(([other, theirs]) => other !== file && theirs.some(unit => unit.needs.includes(each))),
    );
    const text = units
      .map(unit => unit.text)
      .filter(each => each)
      .join("\n");
    const handedOn = !wantedElsewhere.length
      ? isCommonJS && isScript
        ? ""
        : "export {};\n"
      : isCommonJS && isScript
        ? wantedElsewhere.map(each => `exports.${each} = ${each};\n`).join("")
        : `export { ${wantedElsewhere.join(", ")} };\n`;
    files[file] =
      `${language === "unchecked" && file.endsWith(".ts") ? "// @ts-nocheck\n" : ""}${lines}${text}\n${handedOn}`;
    if (language === "a declaration file" && isScript)
      files[file.replace(/\.mjs$/, ".d.mts")] = wantedElsewhere.map(each => types[each]).join("") || "export {};\n";
  }
  if (isTyped) {
    files["globals.d.ts"] =
      "declare const require: (name: string) => object;\ndeclare const process: {\n  getBuiltinModule(name: string): any;\n  nextTick(callback: (...given: any[]) => void, ...given: unknown[]): void;\n};\ninterface ImportMeta {\n  require(name: string): object;\n  url: string;\n}\ndeclare var heldByAll: any;\n";
    files["tsconfig.json"] =
      JSON.stringify(
        {
          compilerOptions: {
            target: "esnext",
            module: "preserve",
            moduleResolution: "bundler",
            noEmit: true,
            strict: true,
            types: [],
            ...(language !== "a declaration file" && { allowJs: true }),
          },
        },
        null,
        2,
      ) + "\n";
  }
  const file = `main.${typed}`;
  const { [file]: text, ...others } = files;
  return { file, text, files: others, ...(thing.worker && { entryPoints: ["works.mjs"] }) };
}
