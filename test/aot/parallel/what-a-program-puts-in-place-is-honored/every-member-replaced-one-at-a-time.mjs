// What a program puts in place of a member of a request, a response or their socket is honored: a wrapped method is called as often and in the same order, a value that is stored anew or
// answered by an accessor is the one that counts. How often a member is READ is not looked at: only the calls of what was wrapped, the answer on the wire and what was thrown.
// One member a case. Two requests a case on one kept connection; the second is the one whose objects are changed. WAYS, ANSWERS: lists by commas to run a part.
import http from "node:http";
import net from "node:net";

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
    takes: (d, made, key) => typeof d.value === "function" && d.writable && !Object.hasOwn(made, key), early: true,
    lay(made, key, d, holder) { holder[key] = wrapperOf(text(key), d.value, false); return () => { holder[key] = d.value; }; },
  },
  "another value stored": { takes: (d, made, key) => "value" in d && d.writable && typeof d.value !== "function" && typeof d.value !== "object" && Object.hasOwn(made, key), lay(made, key, d) { made[key] = other(d.value); } },
  "an accessor that answers another value": {
    takes: (d, made, key) => "value" in d && d.configurable && typeof d.value !== "function" && typeof d.value !== "object" && Object.hasOwn(made, key),
    lay(made, key, d) { let held = d.value; Object.defineProperty(made, key, { configurable: true, enumerable: d.enumerable, get() { return other(held); }, set(value) { held = value; } }); },
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
let current;
let lists = {};
const subjectOf = (subject, req, res) => (subject === "the request" ? req : subject === "the response" ? res : req.socket);
const server = http.createServer((req, res) => {
  entered.resolve();
  if (req.url === "/first") { req.resume(); return void res.end("first"); }
  if (req.url === "/list") {
    for (const subject of ["the request", "the response", "the socket"]) lists[subject] = { made: subjectOf(subject, req, res), members: membersOf(subjectOf(subject, req, res)) };
    req.resume(); return void res.end("listed");
  }
  const made = (watched = subjectOf(current.subject, req, res));
  if (!current.way.early) {
    const descriptor = Reflect.getOwnPropertyDescriptor(holderOf(made, current.key) ?? {}, current.key);
    if (descriptor && current.way.takes(descriptor, made, current.key)) current.way.lay(made, current.key, descriptor);
    else seen.push("NOT THERE");
  }
  try { Promise.resolve(answers[current.answer](req, res)).catch(error => seen.push("REJECTED " + (error?.code ?? error?.name))); } catch (error) { seen.push("THREW " + (error?.code ?? error?.name)); try { res.destroy(); } catch {} }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const headsOf = lines => lines.filter(line => !/^date:/i.test(line));
// No clock says that no answer will come. The client is a socket of this thread and sends a request by one write, so all of it has come once the handler is entered. From there the
// server has its say: what it still does is work of this process alone, and takes the same turns of the loop however busy the machine is. Then the client ends its half of the
// connection, the server closes, and whatever was written comes in front of the close. What is printed stands still from four turns on.
const turn = () => new Promise(resolve => setImmediate(resolve));
const turnsOfTheServer = 16;
let entered = Promise.withResolvers();
function read(bytes, isClosed) {
  const end = bytes.indexOf("\r\n\r\n");
  if (end < 0) return undefined;
  const [first, ...lines] = bytes.toString("latin1", 0, end).split("\r\n");
  const valueOf = name => lines.find(line => line.toLowerCase().startsWith(name + ":"))?.slice(name.length + 1).trim();
  let rest = bytes.subarray(end + 4), body = [], isWhole = false, trailer = "";
  if (/chunked/i.test(valueOf("transfer-encoding") ?? "")) {
    for (let at; (at = rest.indexOf("\r\n")) >= 0; ) {
      const size = parseInt(rest.toString("latin1", 0, at), 16);
      if (size === 0) {
        // Behind the last chunk: an empty line, or lines of a trailer and then an empty line.
        const last = rest.toString("latin1", at + 2), close = last.startsWith("\r\n") ? 0 : last.indexOf("\r\n\r\n");
        isWhole = close >= 0; trailer = isWhole ? last.slice(0, close) : last;
        break;
      }
      if (!(rest.length >= at + 2 + size + 2)) { body.push(rest.subarray(at + 2)); break; }
      body.push(rest.subarray(at + 2, at + 2 + size)); rest = rest.subarray(at + 2 + size + 2);
    }
  } else if (valueOf("content-length") !== undefined) { isWhole = rest.length >= Number(valueOf("content-length")); body = [rest.subarray(0, Number(valueOf("content-length")))]; }
  else { isWhole = isClosed || /^HTTP\/1\.1 (1\d\d|204|304) /.test(first); body = [rest]; }
  if (!isWhole && !isClosed) return undefined;
  return first.slice(first.indexOf(" ") + 1) + " {" + headsOf(lines).join("; ") + "} " + JSON.stringify(String(Buffer.concat(body)).slice(0, 24)) + (trailer ? " and then " + JSON.stringify(trailer) : "") + (isWhole ? "" : " CUT");
}
function connect(line) {
  return new Promise(connected => {
    const socket = (line.socket = net.connect(line.port, "127.0.0.1", () => connected(socket)));
    socket.on("error", () => {}).on("close", () => { if (line.socket === socket) line.socket = undefined; });
  });
}
function send(line, path, method, body = "") {
  return new Promise(async resolve => {
    const isKept = line.socket !== undefined;
    const socket = line.socket ?? (await connect(line));
    let got = Buffer.alloc(0), isEntered = false, hasEnded = false, hasSaid = false, failure;
    const say = said => { hasSaid = true; socket.off("data", onData).off("error", onError).off("close", onClose); resolve(said); };
    const onData = part => { got = Buffer.concat([got, part]); const said = read(got, false); if (said) say(said); };
    const onError = error => { failure = error.code; };
    // A server may let go of a connection that it has kept. Whoever finds that out by a request that nobody has heard sends it once more, on a new connection.
    const onClose = () => say(read(got, true) ?? (isKept && !isEntered ? send(line, path, method, body) : failure ? "failed " + failure : hasEnded ? "no answer" : "closed"));
    socket.on("data", onData).on("error", onError).on("close", onClose);
    const mine = (entered = Promise.withResolvers());
    socket.write(method + " " + path + " HTTP/1.1\r\nHost: 127.0.0.1\r\n" + (body ? "Content-Length: " + body.length + "\r\n" : "") + "\r\n" + body);
    await mine.promise;
    isEntered = true;
    for (let i = 0; i < turnsOfTheServer; i++) await turn();
    if (!hasSaid) { hasEnded = true; socket.end(); }
  });
}
process.on("uncaughtException", error => { seen.push("UNCAUGHT " + (error?.code ?? error?.name)); entered.resolve(); });
function short(list) { return list.length <= 24 ? list.join(", ") : list.slice(0, 24).join(", ") + ", +" + (list.length - 24); }
{
  const line = { port };
  await send(line, "/first", "GET"); await send(line, "/list", "GET"); line.socket?.destroy();
}
const out = [];
for (const answer of chosen("ANSWERS", answers))
  for (const subject of ["the request", "the response", "the socket"])
    for (const wayName of chosen("WAYS", ways)) {
      const way = ways[wayName];
      const { made: sample, members } = lists[subject];
      const keys = [...members].filter(([key, d]) => way.takes(d, sample, key)).map(([key]) => key).sort((a, b) => (text(a) < text(b) ? -1 : 1));
      for (const key of keys) {
        current = { subject, way, key, answer };
        seen = []; watched = undefined;
        const line = { port };
        await send(line, "/first", "GET");
        for (let i = 0; i < 3; i++) await turn();
        const undo = way.early ? way.lay(sample, key, members.get(key), holderOf(sample, key)) : undefined;
        const takesBody = answer.includes("body");
        const said = await send(line, "/second", takesBody ? "POST" : "GET", takesBody ? "x".repeat(1000) : undefined);
        for (let i = 0; i < 3; i++) await turn();
        undo?.();
        line.socket?.destroy();
        out.push(answer + " . " + subject + " . " + wayName + " . " + text(key) + ": " + said + " | " + short(seen));
      }
    }
console.log(out.join("\n"));
process.exit(0);
