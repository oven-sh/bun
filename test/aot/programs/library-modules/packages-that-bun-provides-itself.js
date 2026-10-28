// `ws` and `undici` are not installed: Bun answers those names with modules of its own. A WebSocketServer and a client of `ws` talk to each other, and undici's fetch, request and classes reach a node:http server.
import WebSocket, { WebSocketServer } from "ws";
import { fetch as undiciFetch, request, Agent, Headers, FormData } from "undici";
import http from "node:http";
import { once } from "node:events";

const sockets = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await once(sockets, "listening");
sockets.on("connection", (socket, incoming) => {
  socket.send("welcome " + incoming.url);
  socket.on("message", (data, isBinary) => socket.send(isBinary ? data : "echo " + data, { binary: isBinary }));
});
const client = new WebSocket("ws://127.0.0.1:" + sockets.address().port + "/path");
const messages = [];
client.on("message", (data, isBinary) => messages.push((isBinary ? "binary " : "text ") + data.toString()));
await once(client, "open");
console.log(client.readyState === WebSocket.OPEN, sockets.clients.size);
client.send("hello");
client.send(Buffer.from("bytes"));
while (messages.length < 3) await once(client, "message");
console.log(messages.join(", "));
client.close(1000, "done");
const [code, reason] = await once(client, "close");
console.log(code, reason.toString(), client.readyState === WebSocket.CLOSED);
await new Promise(resolve => sockets.close(resolve));

const server = http.createServer((incoming, response) => response.end(incoming.method + " " + incoming.url + " " + incoming.headers["x-from"]));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const url = "http://127.0.0.1:" + server.address().port;
console.log(await (await undiciFetch(url + "/fetch", { headers: new Headers({ "x-from": "undici" }) })).text());
const answer = await request(url + "/request", { method: "POST", headers: { "x-from": "request" } });
console.log(answer.statusCode, await answer.body.text(), typeof Agent, new FormData() instanceof globalThis.FormData);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
