import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";

const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
server.on("connection", (socket, request) => {
  socket.send("welcome " + request.url);
  socket.on("message", (data, isBinary) => socket.send(isBinary ? data : data.toString().toUpperCase(), { binary: isBinary }));
});
await new Promise<void>(resolve => server.on("listening", () => resolve()));
const client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/path`);
const got: string[] = [];
await new Promise<void>(resolve => {
  client.on("open", () => { client.send("hello"); client.send(Buffer.from([1, 2, 3])); });
  client.on("message", (data, isBinary) => { got.push(isBinary ? "binary " + [...(data as Buffer)].join() : data.toString()); if (got.length === 3) resolve(); });
});
console.log(got.join(" | "));
const closed = new Promise<number>(resolve => client.on("close", code => resolve(code)));
client.close(1000);
console.log(await closed);
server.close();
console.log("DONE");
process.exit(0);
