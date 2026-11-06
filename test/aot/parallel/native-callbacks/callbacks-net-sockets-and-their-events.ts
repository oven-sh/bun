// Native bindings of the library: node:net hands handlers of the library to native sockets, and they emit to the program's listeners: "data" with a Buffer, or a string once an encoding is set, "close" with a boolean, "connection" with a socket.
import { connect, createServer } from "node:net";

let total = 0;

function onData(chunk: string): void {
  total += typeof chunk === "string" ? chunk.length : Buffer.isBuffer(chunk) ? 100 : 10000;
}
function onClose(code: number): void {
  total += typeof code === "number" ? 100000 : typeof code === "boolean" ? 1000000 : 10000000;
}

onData("a");
onClose(0);
const server = createServer(socket => {
  socket.on("data", onData);
  socket.on("close", onClose as any);
  socket.end("reply");
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const client = connect(typeof address === "object" && address ? address.port : 0, "127.0.0.1", () => client.write("hello"));
  client.setEncoding("utf8");
  client.on("data", onData);
  client.on("close", hadError => {
    onClose(hadError as any);
    server.close(() => console.log(total));
  });
});
