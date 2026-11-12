// The methods of the program come by Object.defineProperty and by Object.assign, and one is taken away: each is called as often as without compilation.
import http from "node:http";
import net from "node:net";
const log = [];
const { emit, detachSocket, _callPendingCallbacks: callPendingCallbacks, setHeader } = http.ServerResponse.prototype;
const outgoingSetHeader = http.OutgoingMessage.prototype.setHeader;
Object.defineProperty(http.ServerResponse.prototype, "emit", {
  value(name, ...values) {
    log.push(`emit ${String(name)}`);
    return emit.call(this, name, ...values);
  },
  writable: true,
  configurable: true,
});
Object.defineProperty(http.ServerResponse.prototype, "detachSocket", {
  get() {
    log.push("get detachSocket");
    return detachSocket;
  },
  configurable: true,
});
Object.assign(http.ServerResponse.prototype, {
  _callPendingCallbacks() {
    log.push("_callPendingCallbacks");
    return callPendingCallbacks.call(this);
  },
});
delete http.ServerResponse.prototype.setHeader;
Object.assign(http.OutgoingMessage.prototype, {
  setHeader(name, value) {
    log.push(`OutgoingMessage setHeader ${name}`);
    return outgoingSetHeader.call(this, name, value);
  },
});
let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  log.push(`request ${requests}`);
  if (requests % 2 === 0) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("a");
    res.write("b");
    res.end();
  } else {
    res.setHeader("X-A", "1");
    res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": 2 });
    res.end("ok");
  }
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  let answers = 0;
  client.on("connect", ask);
  client.on("data", (bytes) => {
    const text = String(bytes);
    if (!text.endsWith("ok") && !text.endsWith("0\r\n\r\n")) return;
    if (++answers < 4) return void setImmediate(ask);
    client.destroy();
    server.close();
    setImmediate(() => console.log(log.join("\n")));
  });
});
