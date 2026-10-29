// Objects of library classes come out of an object that was parsed from a text. Every member on their prototype objects is read under a key out of Object.getOwnPropertyNames, Reflect.ownKeys or a list that was parsed from a text: an accessor answers what it answers in plain Bun.
const lines = [];
const box = JSON.parse('{"held":null}');
function nameOf(key) {
  return typeof key === "symbol" ? "@" + key.description : key;
}
function show(value) {
  if (value === null || value === undefined || typeof value === "boolean") return String(value);
  if (typeof value === "object") return Array.isArray(value) ? "list of " + value.length : "object";
  return typeof value;
}
function levelsOf(object) {
  const levels = [];
  for (let level = Object.getPrototypeOf(object); level !== null && level !== Object.prototype; level = Object.getPrototypeOf(level)) levels.push(level);
  return levels;
}
function read(label, key, step) {
  let saw;
  try {
    saw = show(step());
  } catch (error) {
    saw = "throws " + error?.name;
  }
  lines.push(label + ", " + nameOf(key) + ": " + saw);
}
const made = [
  ["a statement", () => new (require("bun:sqlite").Database)(":memory:").query("select 1 as one")],
  ["a database", () => new (require("bun:sqlite").Database)(":memory:")],
  ["an async resource", () => new (require("node:async_hooks").AsyncResource)("resource")],
  ["a socket", () => new (require("node:net").Socket)()],
  ["a readable stream", () => new (require("node:stream").Readable)({ read() {} })],
  ["a writable stream", () => new (require("node:stream").Writable)({ write(chunk, encoding, done) { done(); } })],
  ["a response", () => new (require("node:http").ServerResponse)(new (require("node:http").IncomingMessage)(null))],
  ["an agent", () => new (require("node:http").Agent)()],
  ["a type of media", () => new (require("node:util").MIMEType)("text/plain; charset=utf-8")],
];
for (const [label, make] of made) {
  box.held = make();
  for (const level of levelsOf(box.held)) {
    for (const key of Object.getOwnPropertyNames(level)) read(label + ", by its names", key, () => box.held[key]);
    for (const key of Reflect.ownKeys(level)) read(label + ", by its keys", key, () => Reflect.get(box.held, key));
  }
}
const wanted = JSON.parse('["remoteFamily","remotePort","authorized","pending","bufferSize","connecting","readyState","bytesRead"]');
const server = require("node:http").createServer((request, response) => {
  for (const name of wanted) read("the socket of a request", name, () => request.socket[name]);
  response.end("answered");
});
server.listen(0, async () => {
  lines.push(await (await fetch("http://127.0.0.1:" + server.address().port)).text());
  server.close();
  console.log(lines.join("\n"));
});
