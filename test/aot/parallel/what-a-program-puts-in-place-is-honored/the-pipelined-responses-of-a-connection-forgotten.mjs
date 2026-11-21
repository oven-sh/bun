// As the-pipelined-responses-of-a-connection-left-alone.mjs; the listener stores undefined under the name: the second response is forgotten, as without compilation.
import http from "node:http";
import net from "node:net";
const way = process.env.WAY ?? "forgotten";
const log = [];
let reads = 0;
const server = http.createServer((req, res) => {
  log.push("handler " + req.url);
  if (req.url !== "/one") return res.end("two");
  setTimeout(() => {
    const socket = req.socket;
    const symbol = Object.getOwnPropertySymbols(socket).find(each => each.description === "kConnectionState");
    log.push("the name is there: " + (symbol !== undefined));
    if (symbol !== undefined) {
      const held = socket[symbol];
      log.push("it holds " + (Array.isArray(held?.outgoing) ? "a list of " + held.outgoing.length : String(held)));
      if (way === "forgotten") socket[symbol] = undefined;
      if (way === "emptied") held.outgoing = [];
      if (way === "watched")
        Object.defineProperty(socket, symbol, {
          configurable: true,
          get() {
            reads++;
            return held;
          },
          set() {},
        });
    }
    res.end("one");
  }, 40);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let bytes = "";
const client = net.connect(server.address().port, "127.0.0.1", () => {
  client.write("GET /one HTTP/1.1\r\nHost: a\r\n\r\nGET /two HTTP/1.1\r\nHost: a\r\n\r\n");
});
client.setEncoding("latin1");
client.on("data", part => (bytes += part));
await new Promise(resolve => setTimeout(resolve, 400));
console.log(
  way +
    " | " +
    log.join(" . ") +
    " | bodies: " +
    (bytes.match(/\r\n\r\n(one|two)/g) ?? []).map(each => each.trim()).join(",") +
    " | reads " +
    (reads > 0 ? "some" : "none"),
);
client.destroy();
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
