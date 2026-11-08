// `for await (const chunk of req)` in a server of node:http: the same accessor, laid by Object.defineProperties on a class that is imported by name.
// A program of its own: what one request has once done to a name holds for every later request of the process.
import http, { IncomingMessage } from "node:http";
import { Readable } from "node:stream";

const log = [];
const say = (...words) => log.push(words.join(" "));
// Once a request: how often a stream is read hangs on how the body arrives.
let told = new Set();
const note = words => {
  if (told.has(words)) return;
  told.add(words);
  say("    " + words);
};
let amid = () => {};
async function handle(req, res) {
  told = new Set();
  let chunks = 0, bytes = 0;
  try {
    for await (const chunk of req) {
      chunks++;
      bytes += chunk.length;
      amid(req, chunks, chunk);
    }
    say("  read", bytes, "| ended", req.readableEnded);
  } catch (error) {
    say("  failed", error.code ?? error.message);
  }
  res.end("ok");
}
function send(port, body) {
  return new Promise(resolve => {
    const request = http.request({ port, host: "127.0.0.1", method: "POST", agent: false }, response => {
      clearTimeout(patience);
      response.resume();
      response.on("close", resolve);
    });
    request.on("error", resolve);
    const patience = setTimeout(() => {
      say("  no answer");
      request.destroy();
    }, 1500);
    request.end(body);
  });
}
const server = http.createServer(handle);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const body = "x".repeat(1000);

say("== all requests say that they are destroyed");
Object.defineProperties(IncomingMessage.prototype, { destroyed: { configurable: true, get: () => true } });
await send(port, body);
say("== the accessor is taken away");
delete http.IncomingMessage.prototype.destroyed;
await send(port, body);

await new Promise(resolve => server.close(resolve));
console.log(log.join("\n"));
