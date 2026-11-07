// node:diagnostics_channel, node:http's path for a stream that is no socket, and node:net are first loaded after the program put a
// reportError of its own on globalThis. What a listener throws is an 'uncaughtException', and the function of the program gets nothing.
const log = [];
globalThis.reportError = error => void log.push("reportError of the program: " + error.message);
process.on("uncaughtException", error => void log.push("uncaughtException: " + error.message));

const dc = require("node:diagnostics_channel").channel("throws");
dc.subscribe(() => {
  throw new Error("from the subscriber");
});
dc.publish({});
log.push("publish() returned");

const httpServer = require("node:http").createServer((request, response) => {
  response.on("finish", () => {
    throw new Error("from 'finish'");
  });
  response.on("close", overASocket);
  response.end("body");
});
const [clientSide, serverSide] = require("node:stream").duplexPair();
httpServer.emit("connection", serverSide);
clientSide.resume();
clientSide.end("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");

function overASocket() {
  const net = require("node:net");
  const server = net.createServer(socket => {
    socket.on("data", () => {
      socket.end();
      server.close();
      throw new Error("from 'data'");
    });
    throw new Error("from 'connection'");
  });
  server.listen(0, "127.0.0.1", () => {
    const client = net.connect(server.address().port, "127.0.0.1", () => client.write("x"));
    client.on("close", () => console.log(log.join("\n")));
  });
}
