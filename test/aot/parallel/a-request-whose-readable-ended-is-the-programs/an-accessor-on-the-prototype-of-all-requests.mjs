// The first thing the program does is to lay an accessor `readableEnded` of its own on the prototype of all requests.
// A program of its own: what has once happened to a name holds for every later request of the process, so a second case in one program would prove nothing.
import http from "node:http";
import { Readable } from "node:stream";

const log = [];
const say = (...words) => log.push(words.join(" "));
let asked = 0;
const original = Object.getOwnPropertyDescriptor(Readable.prototype, "readableEnded").get;
Object.defineProperty(http.IncomingMessage.prototype, "readableEnded", {
  get() {
    asked++;
    return original.call(this);
  },
  configurable: true,
});

const server = http.createServer({}, (req, res) => {
  const events = [];
  for (const name of ["data", "end", "close", "error", "aborted"]) req.on(name, () => events.push(name));
  res.on("close", () => setImmediate(() => say("  request:", events.join(" "), "| destroyed", req.destroyed, "| complete", req.complete)));
  if (req.url === "/unread") res.end("ok");
  else req.on("end", () => res.end("ok"));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
function send(path, method, text) {
  return new Promise(resolve => {
    const request = http.request({ port, host: "127.0.0.1", path, method, agent: false }, response => {
      response.resume();
      response.on("close", () => setTimeout(resolve, 20));
    });
    request.on("error", error => {
      say("  the client fails:", error.code);
      setTimeout(resolve, 20);
    });
    request.end(text);
  });
}
for (const [path, method, text] of [["/read", "GET"], ["/unread", "GET"], ["/read", "POST", "x".repeat(300)], ["/unread", "POST", "x".repeat(300)], ["/read", "GET"]]) {
  asked = 0;
  say(method, path);
  await send(path, method, text);
  say("  the program's readableEnded was asked", asked, "times");
}
server.close();
console.log(log.join("\n"));
