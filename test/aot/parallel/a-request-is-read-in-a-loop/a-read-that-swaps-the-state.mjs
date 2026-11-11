// `for await (const chunk of req)`: `read` of the request is an accessor of the program's, and each time it is asked for it lays another state under `_readableState`: read() works on the state that stands there then.
// And an heir of IncomingMessage that says of itself that it is destroyed.
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";

const turn = () => new Promise(resolve => setImmediate(resolve));
{
  const req = new http.IncomingMessage(new net.Socket());
  const other = new Readable({ read() {} });
  other.push("from the other state");
  const own = req._readableState;
  let asked = 0;
  Object.defineProperty(req, "read", {
    configurable: true,
    get() {
      asked++;
      req._readableState = asked === 1 ? other._readableState : own;
      return Readable.prototype.read;
    },
  });
  const got = [];
  const loop = (async () => { for await (const chunk of req) { got.push(String(chunk)); if (got.length === 2) break; } })().catch(error => got.push("failed " + (error.code ?? error.message)));
  await turn();
  req._readableState = own;
  req.push("from its own state");
  await turn();
  req.push(null);
  await Promise.race([loop, new Promise(resolve => setTimeout(resolve, 300))]);
  console.log("read was asked for", asked > 0, "|", got.join(" | "));
}
{
  class Mine extends http.IncomingMessage {
    get destroyed() {
      return true;
    }
  }
  const req = new Mine(new net.Socket());
  req.push("never seen");
  const got = [];
  const loop = (async () => { for await (const chunk of req) got.push(String(chunk)); })().catch(error => got.push("failed " + (error.code ?? error.message)));
  await Promise.race([loop, new Promise(resolve => setTimeout(resolve, 300))]);
  console.log("an heir that says it is destroyed |", got.join(" | ") || "nothing");
}
process.exit(0);
