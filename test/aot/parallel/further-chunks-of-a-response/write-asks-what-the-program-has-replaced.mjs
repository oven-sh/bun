// A program replaces what write() asks a response for, on the response and on the prototype, between the chunks of one response: each is called as often as without compilation.
import http from "node:http";
import net from "node:net";
const log = [];
let requests = 0;
const prototype = http.ServerResponse.prototype;
const outgoing = http.OutgoingMessage.prototype;
function counting(holder, name, label) {
  const original = holder[name];
  holder[name] = function (...values) {
    log.push(`${label} ${name}(${values.join(",")})`);
    return original.apply(this, values);
  };
  return () => (holder === prototype || holder === outgoing ? (holder[name] = original) : delete holder[name]);
}
const server = http.createServer((req, res) => {
  requests++;
  log.push(`request ${requests}`);
  res.write("a");
  let restore = [];
  if (requests === 2) restore = [counting(res, "_callPendingCallbacks", "own"), counting(res, "getHeader", "own")];
  if (requests === 3) restore = [counting(prototype, "_callPendingCallbacks", "prototype"), counting(outgoing, "getHeader", "prototype")];
  if (requests === 4) Object.defineProperty(res, "writableHighWaterMark", { get() { log.push("own writableHighWaterMark"); return 1; }, configurable: true });
  if (requests === 5) {
    Object.defineProperty(res, "socket", {
      get() { log.push("own socket"); return req.socket; },
      set(value) { log.push(`own socket = ${value === null ? "null" : typeof value}`); },
      configurable: true,
    });
  }
  log.push(res.write("b"), res.write("c", () => log.push(`callback ${requests}`)), res.write("d"));
  for (const undo of restore) undo();
  log.push(res.write("e"));
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  let answers = 0;
  client.on("connect", ask);
  client.on("data", (bytes) => {
    if (!String(bytes).endsWith("0\r\n\r\n")) return;
    if (++answers < 6) return void ask();
    client.destroy();
    server.close();
    console.log(log.join("\n"));
  });
});
