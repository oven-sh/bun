import http from "node:http";
import { Server } from "socket.io";
import { io } from "socket.io-client";
import { listen } from "./lib_http.ts";

const server = http.createServer();
const sockets = new Server(server);
sockets.on("connection", socket => {
  socket.on("double", (n: number, reply: (value: number) => void) => reply(n * 2));
  socket.on("join", (room: string) => { void socket.join(room); sockets.to(room).emit("joined", room); });
});
const port = await listen(server);
for (const transports of [["websocket"], ["polling"]]) {
  const client = io(`http://127.0.0.1:${port}`, { transports, reconnection: false });
  await new Promise<void>((resolve, reject) => { client.on("connect", () => resolve()); client.on("connect_error", reject); });
  console.log(transports[0], await client.emitWithAck("double", 21));
  console.log(await new Promise<string>(resolve => { client.on("joined", resolve); client.emit("join", "room1"); }));
  client.disconnect();
}
await sockets.close();
console.log("DONE");
process.exit(0);
