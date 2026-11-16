// The program lays methods of its own on the prototypes of a response at its top, ahead of every request: each is called as often as without compilation.
import http from "node:http";
import net from "node:net";
const log = [];
const emit = http.ServerResponse.prototype.emit;
http.ServerResponse.prototype.emit = function (name, ...values) {
  log.push(`emit ${String(name)}`);
  return emit.call(this, name, ...values);
};
const detachSocket = http.ServerResponse.prototype.detachSocket;
http.ServerResponse.prototype.detachSocket = function (socket) {
  log.push("detachSocket");
  return detachSocket.call(this, socket);
};
const callPendingCallbacks = http.ServerResponse.prototype._callPendingCallbacks;
http.ServerResponse.prototype._callPendingCallbacks = function () {
  log.push("_callPendingCallbacks");
  return callPendingCallbacks.call(this);
};
const setHeader = http.ServerResponse.prototype.setHeader;
http.ServerResponse.prototype.setHeader = function (name, value) {
  log.push(`setHeader ${name}`);
  return setHeader.call(this, name, value);
};
const outgoingSetHeader = http.OutgoingMessage.prototype.setHeader;
http.OutgoingMessage.prototype.setHeader = function (name, value) {
  log.push(`OutgoingMessage setHeader ${name}`);
  return outgoingSetHeader.call(this, name, value);
};
const hasHeader = http.OutgoingMessage.prototype.hasHeader;
http.OutgoingMessage.prototype.hasHeader = function (name) {
  log.push(`hasHeader ${name}`);
  return hasHeader.call(this, name);
};
const getHeader = http.OutgoingMessage.prototype.getHeader;
http.OutgoingMessage.prototype.getHeader = function (name) {
  log.push(`getHeader ${name}`);
  return getHeader.call(this, name);
};
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
