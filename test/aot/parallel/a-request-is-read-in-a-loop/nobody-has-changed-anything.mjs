// `for await (const chunk of req)` in a server of node:http: nobody has changed anything; something is put back amid the loop and the state is marked as destroyed.
// A program of its own: what one request has once done to a name holds for every later request of the process.
import http from "node:http";
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

say("== as it comes");
await send(port, body);
await send(port, "");
say("== something is put back amid the loop");
amid = (req, chunks, chunk) => {
  say("    a chunk of", chunk.length);
  if (chunks === 1) req.unshift(Buffer.from("put back"));
};
await send(port, body);
say("== something is put back and the state is marked as destroyed");
amid = (req, chunks, chunk) => {
  say("    a chunk of", chunk.length);
  if (chunks !== 1) return;
  req.unshift(Buffer.from("put back"));
  req._readableState.destroyed = true;
};
await send(port, body);
say("== something is put back and the request is destroyed");
amid = (req, chunks, chunk) => {
  say("    a chunk of", chunk.length);
  if (chunks !== 1) return;
  req.unshift(Buffer.from("put back"));
  req.destroy();
};
await send(port, body);
amid = () => {};
say("== as it comes, again");
await send(port, body);

await new Promise(resolve => server.close(resolve));
console.log(log.join("\n"));
