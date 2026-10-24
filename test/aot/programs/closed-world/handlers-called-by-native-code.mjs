// node:net hands handlers of its own to native code (Bun.listen, Bun.connect), and native code calls them. A load by a computed name holds what node:net exports without calling it, also when the program hands the answer on to native code. The handlers are operands of a native call, so they are compiled all the same, and the server and the client talk as in plain Bun.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
import net from "node:net";
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
const loaded = unknown(await import(decoded("node:net")));
console.log(loaded.default === net, typeof loaded.createServer);

const server = net.createServer(socket => {
  socket.on("data", chunk => socket.end("got " + chunk));
});
server.on("close", () => console.log("closed"));
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1", () => client.write("ping"));
  client.on("data", chunk => {
    console.log(String(chunk));
    client.destroy();
    server.close();
  });
});
