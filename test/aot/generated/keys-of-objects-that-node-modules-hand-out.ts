// What a program sees when it lists an object that node:events, node:stream, node:net or node:http hands out: the own keys of the object
// and of each prototype above it, names and symbols in their order, with the attributes of each and the kind of value it holds. A program
// takes one kind of object. It lists a new one, then calls each public method on a new one of its own and lists that, and lists what the
// method returned. The methods are those that the prototypes of the Bun that runs the test have, so a new method is called too. The
// requests, responses and sockets of a server and of a client come out of an exchange each. A program about a module lists the module,
// each of its members that is an object or a function, and the prototype of each class.
import events from "node:events";
import http from "node:http";
import net from "node:net";
import stream from "node:stream";

type Subject = {
  name: string;
  /** An expression that makes one. */
  make?: string;
  /** Which object of an exchange it is. */
  inExchange?: "req" | "res" | "socket" | "clientRequest" | "clientResponse" | "accepted" | "connected";
  /** The module whose members it lists. */
  module?: "events" | "stream" | "net" | "http";
  prototype: object;
};

const readable = "new stream.Readable({ read() {} })";
const writable = "new stream.Writable({ write(chunk, encoding, done) { done(); } })";
const incoming = "new http.IncomingMessage(new net.Socket())";

export const subjects: Subject[] = [
  { name: "an emitter", make: "new events.EventEmitter()", prototype: events.EventEmitter.prototype },
  {
    name: "an emitter that captures rejections",
    make: "new events.EventEmitter({ captureRejections: true })",
    prototype: events.EventEmitter.prototype,
  },
  {
    name: "an emitter that is a resource",
    make: 'new events.EventEmitterAsyncResource({ name: "made" })',
    prototype: events.EventEmitterAsyncResource.prototype,
  },
  { name: "a stream", make: "new stream.Stream()", prototype: stream.Stream.prototype },
  { name: "a readable", make: readable, prototype: stream.Readable.prototype },
  { name: "a readable from a list", make: 'stream.Readable.from(["a", "b"])', prototype: stream.Readable.prototype },
  { name: "a writable", make: writable, prototype: stream.Writable.prototype },
  {
    name: "a duplex",
    make: "new stream.Duplex({ read() {}, write(chunk, encoding, done) { done(); } })",
    prototype: stream.Duplex.prototype,
  },
  {
    name: "a transform",
    make: "new stream.Transform({ transform(chunk, encoding, done) { done(null, chunk); } })",
    prototype: stream.Transform.prototype,
  },
  { name: "a pass-through", make: "new stream.PassThrough()", prototype: stream.PassThrough.prototype },
  { name: "the state of a readable", make: `${readable}._readableState`, prototype: Object.prototype },
  { name: "the state of a writable", make: `${writable}._writableState`, prototype: Object.prototype },
  { name: "a socket", make: "new net.Socket()", prototype: net.Socket.prototype },
  { name: "a server of sockets", make: "net.createServer()", prototype: net.Server.prototype },
  { name: "a block list", make: "new net.BlockList()", prototype: net.BlockList.prototype },
  {
    name: "a socket address",
    make: 'new net.SocketAddress({ address: "127.0.0.1", port: 80 })',
    prototype: net.SocketAddress.prototype,
  },
  { name: "an agent", make: "new http.Agent({ keepAlive: true })", prototype: http.Agent.prototype },
  { name: "a server", make: "http.createServer()", prototype: http.Server.prototype },
  { name: "an outgoing message", make: "new http.OutgoingMessage()", prototype: http.OutgoingMessage.prototype },
  { name: "an incoming message", make: incoming, prototype: http.IncomingMessage.prototype },
  {
    name: "a response made by hand",
    make: `new http.ServerResponse(${incoming})`,
    prototype: http.ServerResponse.prototype,
  },
  { name: "the request of a server", inExchange: "req", prototype: http.IncomingMessage.prototype },
  { name: "the response of a server", inExchange: "res", prototype: http.ServerResponse.prototype },
  { name: "the socket of a server's request", inExchange: "socket", prototype: net.Socket.prototype },
  { name: "the request of a client", inExchange: "clientRequest", prototype: http.ClientRequest.prototype },
  { name: "the response of a client", inExchange: "clientResponse", prototype: http.IncomingMessage.prototype },
  { name: "a socket that a server accepted", inExchange: "accepted", prototype: net.Socket.prototype },
  { name: "a socket that has connected", inExchange: "connected", prototype: net.Socket.prototype },
  { name: "the members of node:events", module: "events", prototype: Object.prototype },
  { name: "the members of node:stream", module: "stream", prototype: Object.prototype },
  { name: "the members of node:net", module: "net", prototype: Object.prototype },
  { name: "the members of node:http", module: "http", prototype: Object.prototype },
];

const listener = "function heard() {}";
const given: Record<string, string> = {
  on: `"seen", ${listener}`,
  once: `"seen", ${listener}`,
  addListener: `"seen", ${listener}`,
  prependListener: `"seen", ${listener}`,
  prependOnceListener: `"seen", ${listener}`,
  off: `"seen", ${listener}`,
  removeListener: `"seen", ${listener}`,
  removeAllListeners: `"seen"`,
  emit: `"seen", 1`,
  listeners: `"seen"`,
  rawListeners: `"seen"`,
  listenerCount: `"seen"`,
  setMaxListeners: "5",
  setEncoding: `"utf8"`,
  setDefaultEncoding: `"utf8"`,
  push: `"a"`,
  unshift: `"a"`,
  write: `"a"`,
  end: `"a"`,
  pipe: "new stream.PassThrough()",
  unpipe: "new stream.PassThrough()",
  wrap: "new stream.PassThrough()",
  setTimeout: "1000",
  setKeepAlive: "true, 1000",
  setNoDelay: "true",
  setHeader: `"x-one", "1"`,
  appendHeader: `"x-one", "2"`,
  getHeader: `"x-one"`,
  hasHeader: `"x-one"`,
  removeHeader: `"x-one"`,
  setHeaders: `new Map([["x-one", "1"]])`,
  writeHead: `201, { "x-one": "1" }`,
  writeEarlyHints: `{ link: "</a.css>; rel=preload" }`,
  addTrailers: `{ "x-last": "1" }`,
  assignSocket: "new net.Socket()",
  detachSocket: "made.socket",
  map: "chunk => chunk",
  filter: "chunk => true",
  flatMap: "chunk => [chunk]",
  forEach: "chunk => {}",
  some: "chunk => true",
  every: "chunk => true",
  find: "chunk => true",
  reduce: "(sum, chunk) => sum + chunk, 0",
  take: "1",
  drop: "1",
  compose: "new stream.PassThrough()",
  addAddress: `"127.0.0.1"`,
  addRange: `"127.0.0.1", "127.0.0.9"`,
  addSubnet: `"127.0.0.0", 8`,
  check: `"127.0.0.1"`,
  getName: `{ host: "localhost", port: 80 }`,
  runInAsyncScope: "() => 1",
  getConnections: "() => {}",
};

// What opens a port, dials out or waits for the other side has an exchange of its own above.
const left = new Set([
  "constructor",
  "listen",
  "connect",
  "createConnection",
  "createSocket",
  "addRequest",
  "onSocket",
  "toJSON",
]);

function publicMethodsOf(prototype: object): string[] {
  const names: string[] = [];
  for (
    let level: object | null = prototype;
    level !== null && level !== Object.prototype;
    level = Object.getPrototypeOf(level)
  ) {
    for (const name of Object.getOwnPropertyNames(level)) {
      if (name.startsWith("_") || left.has(name) || names.includes(name)) continue;
      if (typeof Object.getOwnPropertyDescriptor(level, name)!.value === "function") names.push(name);
    }
  }
  return names;
}

const looks = `
const events = require("node:events"), stream = require("node:stream"), net = require("node:net"), http = require("node:http");
const lines = [];
function kindOf(value) {
  if (value === null || value === undefined || typeof value === "boolean") return String(value);
  if (typeof value === "function") return "function " + value.name + "/" + value.length;
  if (typeof value === "object") return Array.isArray(value) ? "list" : "object";
  return typeof value;
}
function keysOf(object) {
  return Reflect.ownKeys(object).map(key => {
    const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
    const name = typeof key === "symbol" ? "@" + key.description : key;
    const attributes = (descriptor.configurable ? "c" : "-") + (descriptor.enumerable ? "e" : "-");
    if (!("value" in descriptor)) return name + ":" + attributes + (descriptor.get ? "g" : "-") + (descriptor.set ? "s" : "-");
    return name + ":" + attributes + (descriptor.writable ? "w" : "-") + " " + kindOf(descriptor.value);
  }).join(", ");
}
const seen = new Map();
function look(label, object) {
  let depth = 0;
  for (let level = object; level !== null && level !== Object.prototype && level !== Function.prototype; level = Object.getPrototypeOf(level)) {
    const keys = keysOf(level);
    const at = depth++;
    if (at > 0 && seen.get(level) === keys) continue;
    if (at > 0) seen.set(level, keys);
    lines.push(label + ", level " + at + ": " + keys);
  }
}
function lookAtResult(label, result, made) {
  if (result === made) return void lines.push(label + " returns the object");
  if ((typeof result !== "object" && typeof result !== "function") || result === null) return void lines.push(label + " returns " + kindOf(result));
  if (typeof result.then === "function") result.then(() => {}, () => {});
  if (typeof result.on === "function") result.on("error", () => {});
  look(label + " returns", result);
}
function letGo(object) {
  for (const name of ["destroy", "close"]) {
    try {
      if (typeof object?.[name] === "function") object[name]();
    } catch {}
  }
}
function quiet(object) {
  if (typeof object.on === "function") object.on("error", () => {});
  return object;
}
`;

function stepOn(method: string): string {
  return `  let result;
  try {
    result = made.${method}(${given[method] ?? ""});
  } catch (error) {
    lines.push("${method} throws " + error.name + " " + error.code);
  }
  look("behind ${method}", made);
  lookAtResult("${method}", result, made);`;
}

const done = `console.log(lines.join("\\n"));\nsetTimeout(() => process.exit(0), 50);`;

/** The text of the program about the methods `from` up to `to` of a subject. The first of a subject also lists a new object. */
export function programAbout(subject: Subject, from: number, to: number): string {
  if (subject.module) {
    return `${looks}
look("the module", ${subject.module});
for (const key of Reflect.ownKeys(${subject.module})) {
  const member = ${subject.module}[key];
  if ((typeof member !== "object" && typeof member !== "function") || member === null) continue;
  look(String(key), member);
  if (typeof member === "function" && typeof member.prototype === "object" && member.prototype !== null) look(String(key) + ".prototype", member.prototype);
}
${done}
`;
  }
  const methods = publicMethodsOf(subject.prototype).slice(from, to);
  const steps = [...(from === 0 ? [`  look("new", made);`] : []), ...methods.map(stepOn)];
  if (subject.make) {
    return `${looks}
${steps.map(step => `{\n  const made = quiet(${subject.make});\n${step}\n  letGo(made);\n}`).join("\n")}
${done}
`;
  }
  const list = `const steps = [\n${steps.map(step => `made => {\n${step}\n},`).join("\n")}\n];`;
  const which = subject.inExchange!;
  if (which === "accepted" || which === "connected") {
    return `${looks}
${list}
let turn = 0;
const server = net.createServer(accepted => {
  quiet(accepted);
  ${which === "accepted" ? "steps[turn](accepted);" : ""}
  letGo(accepted);
});
server.listen(0, "127.0.0.1", async () => {
  for (; turn < steps.length; turn++) {
    await new Promise(resolve => {
      const connected = quiet(net.connect(server.address().port, "127.0.0.1", () => {
        ${which === "connected" ? "steps[turn](connected);" : ""}
      }));
      connected.on("close", resolve);
      connected.resume();
      ${which === "connected" ? 'connected.on("connect", () => letGo(connected));' : ""}
    });
  }
  server.close();
  ${done}
});
`;
  }
  const inServer = which === "req" || which === "res" || which === "socket";
  return `${looks}
${list}
let turn = 0;
const server = http.createServer((req, res) => {
  quiet(req), quiet(res);
  ${inServer ? `steps[turn](${which === "socket" ? "req.socket" : which});` : ""}
  try {
    if (!res.writableEnded) res.end("ok");
  } catch {}
});
server.listen(0, "127.0.0.1", async () => {
  for (; turn < steps.length; turn++) {
    await new Promise(resolve => {
      const clientRequest = quiet(http.get({ port: server.address().port, host: "127.0.0.1", agent: false }, clientResponse => {
        quiet(clientResponse);
        ${which === "clientResponse" ? "steps[turn](clientResponse);" : ""}
        clientResponse.resume();
      }));
      clientRequest.on("close", resolve);
      ${which === "clientRequest" ? "steps[turn](clientRequest);" : ""}
    });
  }
  server.close();
  server.closeAllConnections();
  ${done}
});
`;
}

export function numberOfMethodsOf(subject: Subject): number {
  return publicMethodsOf(subject.prototype).length;
}
