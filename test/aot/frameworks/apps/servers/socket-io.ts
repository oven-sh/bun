import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io } from "socket.io-client";

interface ClientToServer {
  hello: (name: string, reply: (text: string) => void) => void;
}
interface ServerToClient {
  news: (items: number[]) => void;
}
const httpServer = createServer();
const server = new Server<ClientToServer, ServerToClient>(httpServer);
server.on("connection", socket => {
  socket.on("hello", (name, reply) => {
    reply(`world ${name}`);
    socket.emit("news", [1, 2, 3]);
  });
});
await new Promise<void>(resolve => httpServer.listen(0, resolve));
for (const transports of [["websocket"], ["polling"]]) {
  const client = io(`http://localhost:${(httpServer.address() as AddressInfo).port}`, {
    transports,
    reconnection: false,
  });
  const news = new Promise<number[]>(resolve => client.on("news", resolve));
  console.log(
    transports[0],
    await client.emitWithAck("hello", "bun"),
    client.connected,
    (await news).join(),
    client.io.engine.transport.name,
  );
  client.close();
}
await server.close();
