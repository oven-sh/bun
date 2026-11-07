// What a program puts in place of a member AMID an answer is honored from then on: the change is made where code of the program runs between two steps of the library: in a listener, a callback,
// a getter of an object that the program hands over, a tick, a microtask. One member and one place a case. Compared: the calls of what was wrapped, the answer on the wire, what was thrown; never how often a member is read.
import http from "node:http";

const text = key => (typeof key === "symbol" ? "[" + String(key.description) + "]" : key);
let seen = [];
let watched;
const kinds = value => (value === null ? "null" : Array.isArray(value) ? "list" : typeof value);
function wrapperOf(name, original, always) {
  return function (...values) {
    if (always || this === watched) seen.push(name + "(" + values.map(kinds).join(" ") + ")");
    return Reflect.apply(original, this, values);
  };
}
function other(value) {
  switch (typeof value) {
    case "boolean": return !value;
    case "number": return value === 200 ? 201 : value + 1;
    case "string": return value === "" ? "x" : value + "x";
    case "undefined": return null;
    default: return value === null ? undefined : value;
  }
}
function holderOf(made, key) {
  for (let level = made; level && level !== Object.prototype; level = Object.getPrototypeOf(level)) if (Object.hasOwn(level, key)) return level;
  return undefined;
}
function membersOf(made) {
  const names = new Map();
  for (let level = made; level && level !== Object.prototype; level = Object.getPrototypeOf(level))
    for (const key of Reflect.ownKeys(level)) if (!names.has(key) && key !== "constructor") names.set(key, Reflect.getOwnPropertyDescriptor(level, key));
  return names;
}
const ways = {
  "a wrapper on the object": { takes: d => typeof d.value === "function", lay(made, key, d) { made[key] = wrapperOf(text(key), d.value, true); } },
  "a wrapper on the prototype": {
    takes: (d, made, key) => typeof d.value === "function" && d.writable && !Object.hasOwn(made, key),
    lay(made, key, d, holder) { holder[key] = wrapperOf(text(key), d.value, false); return () => { holder[key] = d.value; }; },
  },
  "another value stored": { takes: (d, made, key) => "value" in d && d.writable && typeof d.value !== "function" && typeof d.value !== "object" && Object.hasOwn(made, key), lay(made, key, d) { made[key] = other(d.value); } },
  "an accessor that answers another value": {
    takes: (d, made, key) => "value" in d && d.configurable && typeof d.value !== "function" && typeof d.value !== "object" && Object.hasOwn(made, key),
    lay(made, key, d) { let held = d.value; Object.defineProperty(made, key, { configurable: true, enumerable: d.enumerable, get() { return other(held); }, set(value) { held = value; } }); },
  },
};
const places = ["in the handler", "newListener of the request", "data", "end of the request", "a getter of the head", "behind the head", "the callback of the first write", "between two writes", "the callback of end", "behind end", "prefinish", "finish", "close of the response", "close of the request", "a tick", "a microtask", "an immediate"];
function answer(req, res, at) {
  req.on("newListener", () => at("newListener of the request"));
  at("in the handler");
  process.nextTick(() => at("a tick")); queueMicrotask(() => at("a microtask")); setImmediate(() => at("an immediate"));
  let size = 0;
  req.on("data", part => { at("data"); size += part.length; });
  req.on("close", () => at("close of the request"));
  res.on("prefinish", () => at("prefinish")); res.on("finish", () => at("finish")); res.on("close", () => at("close of the response"));
  req.on("end", () => {
    at("end of the request");
    res.writeHead(200, { get "x-made-up"() { at("a getter of the head"); return "1"; }, "content-type": "text/plain" });
    at("behind the head");
    res.write("a", () => at("the callback of the first write"));
    at("between two writes");
    res.write(String(size));
    res.end("c", () => at("the callback of end"));
    at("behind end");
  });
}
const chosen = (name, all) => (process.env[name] ? process.env[name].split(",") : Object.keys(all));
let current;
let lists = {};
const subjectOf = (subject, req, res) => (subject === "the request" ? req : subject === "the response" ? res : req.socket);
const server = http.createServer((req, res) => {
  if (req.url === "/first") { req.resume(); return void res.end("first"); }
  if (req.url === "/list") {
    for (const subject of ["the request", "the response", "the socket"]) lists[subject] = { made: subjectOf(subject, req, res), members: membersOf(subjectOf(subject, req, res)) };
    req.resume(); return void res.end("listed");
  }
  const made = (watched = subjectOf(current.subject, req, res));
  let isLaid = false;
  const at = place => {
    if (isLaid || place !== current.place) return;
    isLaid = true;
    const holder = holderOf(made, current.key);
    const descriptor = Reflect.getOwnPropertyDescriptor(holder ?? {}, current.key);
    if (descriptor && current.way.takes(descriptor, made, current.key)) current.undo = current.way.lay(made, current.key, descriptor, holder);
    else seen.push("NOT THERE");
    seen.push("LAID");
  };
  try { answer(req, res, at); } catch (error) { seen.push("THREW " + (error?.code ?? error?.name)); try { res.destroy(); } catch {} }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
function send(agent, path, method, body) {
  return new Promise(resolve => {
    const request = http.request({ port, host: "127.0.0.1", method, path, agent }, response => {
      const parts = [];
      response.on("data", part => parts.push(part));
      response.on("close", () => {
        clearTimeout(patience);
        const heads = [];
        for (let at = 0; at < response.rawHeaders.length; at += 2) heads.push(response.rawHeaders[at] + ": " + (response.rawHeaders[at].toLowerCase() === "date" ? "*" : response.rawHeaders[at + 1]));
        resolve(response.statusCode + " " + response.statusMessage + " {" + heads.join("; ") + "} " + JSON.stringify(String(Buffer.concat(parts)).slice(0, 24)) + (response.complete ? "" : " CUT"));
      });
    });
    request.on("error", error => { clearTimeout(patience); resolve("failed " + error.code); });
    const patience = setTimeout(() => { request.destroy(); resolve("no answer"); }, 250);
    request.end(body);
  });
}
const turn = () => new Promise(resolve => setImmediate(resolve));
process.on("uncaughtException", error => seen.push("UNCAUGHT " + (error?.code ?? error?.name)));
function short(list) { return list.length <= 24 ? list.join(", ") : list.slice(0, 24).join(", ") + ", +" + (list.length - 24); }
{
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  await send(agent, "/first", "GET"); await send(agent, "/list", "GET"); agent.destroy();
}
const out = [];
for (const place of chosen("PLACES", Object.fromEntries(places.map(p => [p, 1]))))
  for (const subject of ["the request", "the response", "the socket"])
    for (const wayName of chosen("WAYS", ways)) {
      const way = ways[wayName];
      const { made: sample, members } = lists[subject];
      const keys = [...members].filter(([key, d]) => way.takes(d, sample, key)).map(([key]) => key).sort((a, b) => (text(a) < text(b) ? -1 : 1));
      for (const key of keys) {
        current = { subject, way, key, place, undo: undefined };
        seen = []; watched = undefined;
        const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
        await send(agent, "/first", "GET");
        for (let i = 0; i < 3; i++) await turn();
        const said = await send(agent, "/second", "POST", "x".repeat(1000));
        for (let i = 0; i < 4; i++) await turn();
        current.undo?.();
        agent.destroy();
        out.push(place + " . " + subject + " . " + wayName + " . " + text(key) + ": " + said + " | " + short(seen));
      }
    }
console.log(out.join("\n"));
process.exit(0);
