// ws.handleUpgrade() from a 'request' listener takes the connection out of HTTP. No 'finish' comes for the response, so it keeps the connection as its socket, as in Node: destroy() of the response closes the connection, and the response emits 'close'.
const http = require("node:http");
const { WebSocketServer } = require("ws");
const out = [];
const wss = new WebSocketServer({ noServer: true });
const server = http.createServer((req, res) => {
  const socket = req.socket;
  const at = name => out.push(name + ": res.socket is " + (res.socket === socket && res.connection === socket ? "the connection" : String(res.socket)));
  at("before");
  res.on("close", () => out.push("the response closes: closed " + res.closed + ", the connection destroyed " + socket.destroyed));
  wss.handleUpgrade(req, socket, Buffer.alloc(0), ws => {
    at("callback");
    ws.on("message", data => {
      at("message " + data);
      // The client has the echo when it asks for the end.
      if (String(data) === "echo") ws.send("echo");
      else res.destroy();
    });
    ws.on("close", code => {
      at("close of the WebSocket, with " + code);
      setImmediate(() => {
        console.log(out.join("\n"));
        server.close();
      });
    });
  });
  at("after");
});
server.listen(0, "127.0.0.1", () => {
  const client = new WebSocket("ws://127.0.0.1:" + server.address().port);
  client.onopen = () => client.send("echo");
  client.onmessage = () => client.send("end");
  client.onerror = () => {};
});
