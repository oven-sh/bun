// What an heir declares is honored: createServer({ IncomingMessage: Mine, ServerResponse: Mine }) with a class of the program below the library's: one member a case: a method of the heir that goes on to the one above,
// an accessor of the heir that answers another value than the one above, a plain value on the heir's prototype. Compared: the calls of the heir's methods, the answer on the wire, what was thrown.
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
  "a method of the heir": { takes: d => typeof d.value === "function", lay(prototype, key, d) { Object.defineProperty(prototype, key, { configurable: true, writable: true, value: wrapperOf(text(key), d.value, true) }); } },
  "an accessor of the heir that answers another value": {
    takes: d => typeof d.get === "function",
    lay(prototype, key, d) { Object.defineProperty(prototype, key, { configurable: true, get() { return other(Reflect.apply(d.get, this, [])); }, set(value) { if (d.set) Reflect.apply(d.set, this, [value]); } }); },
  },
  "an accessor of the heir that counts as a call": {
    takes: d => typeof d.get === "function",
    lay(prototype, key, d) { Object.defineProperty(prototype, key, { configurable: true, get() { const value = Reflect.apply(d.get, this, []); if (!seen.includes("get " + text(key))) seen.push("get " + text(key)); return value; }, set(value) { if (d.set) Reflect.apply(d.set, this, [value]); } }); },
  },
};
const answers = {
  "end with a text": (req, res) => res.end("ok"),
  "a head, two writes, end": (req, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.write("a"); res.write("b"); res.end(); },
  "headers set one by one": (req, res) => { res.statusCode = 202; res.setHeader("x-made-up", "1"); res.setHeader("x-other", ["a", "b"]); res.removeHeader("x-made-up"); res.end("ok"); },
  "the body by listeners": (req, res) => { const parts = []; req.on("data", part => parts.push(part)); req.on("end", () => res.end(String(Buffer.concat(parts).length))); },
  "the body piped back": (req, res) => { req.pipe(res); },
};
const chosen = (name, all) => (process.env[name] ? process.env[name].split(",") : Object.keys(all));
let lists = {};
function send(port, agent, path, method, body) {
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
function membersAbove(prototype) {
  const names = new Map();
  for (let level = prototype; level && level !== Object.prototype; level = Object.getPrototypeOf(level))
    for (const key of Reflect.ownKeys(level)) if (!names.has(key) && key !== "constructor") names.set(key, Reflect.getOwnPropertyDescriptor(level, key));
  return names;
}
const bases = { "the request": http.IncomingMessage, "the response": http.ServerResponse };
const out = [];
for (const answer of chosen("ANSWERS", answers))
  for (const subject in bases)
    for (const wayName of chosen("WAYS", ways)) {
      const way = ways[wayName];
      const members = membersAbove(bases[subject].prototype);
      const keys = [...members].filter(([, d]) => way.takes(d)).map(([key]) => key).sort((a, b) => (text(a) < text(b) ? -1 : 1));
      for (const key of keys) {
        seen = [];
        const Mine = class extends bases[subject] {};
        way.lay(Mine.prototype, key, members.get(key));
        let isWatching = false;
        const server = http.createServer(subject === "the request" ? { IncomingMessage: Mine } : { ServerResponse: Mine }, (req, res) => {
          if (req.url === "/first") { req.resume(); return void res.end("first"); }
          try { Promise.resolve(answers[answer](req, res)).catch(error => seen.push("REJECTED " + (error?.code ?? error?.name))); } catch (error) { seen.push("THREW " + (error?.code ?? error?.name)); try { res.destroy(); } catch {} }
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const port = server.address().port;
        const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
        await send(port, agent, "/first", "GET");
        for (let i = 0; i < 3; i++) await turn();
        seen = [];
        const takesBody = answer.includes("body");
        const said = await send(port, agent, "/second", takesBody ? "POST" : "GET", takesBody ? "x".repeat(1000) : undefined);
        for (let i = 0; i < 3; i++) await turn();
        agent.destroy();
        server.close();
        out.push(answer + " . " + subject + " . " + wayName + " . " + text(key) + ": " + said + " | " + short(seen));
      }
    }
console.log(out.join("\n"));
process.exit(0);
