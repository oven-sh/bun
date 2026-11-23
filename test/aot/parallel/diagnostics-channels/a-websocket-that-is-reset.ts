// A WebSocket publishes the error of its socket if the peer resets the connection.
import { createHash } from "node:crypto";
import { subscribe } from "node:diagnostics_channel";
import { once } from "node:events";
import net from "node:net";

subscribe("undici:websocket:socket_error", ({ message, code, syscall, errno }: any) =>
  console.log(message, code, syscall, typeof errno),
);

const server = net.createServer(async socket => {
  const key = /sec-websocket-key: (.+)/i.exec(String(await once(socket, "data")))![1];
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  await once(socket, "data");
  socket.resetAndDestroy();
});
await once(server.listen(0, "127.0.0.1"), "listening");

const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
ws.onopen = () => ws.send("reset");
console.log((await once(ws, "close"))[0].code);
server.close();
