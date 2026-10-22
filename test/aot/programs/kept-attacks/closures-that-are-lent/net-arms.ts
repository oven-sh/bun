// Closures that are lent: net arms. It prints what plain Bun prints.
import net from "node:net";
const server = net.createServer(socket => { socket.on("data", d => socket.write(d)); socket.on("end", () => {}); });
server.listen(0, () => {
  const port = (server.address() as any).port;
  let left = 200;
  const go = () => {
    const c = net.connect(port, "127.0.0.1", () => c.write("x"));
    c.on("data", () => c.end());
    c.on("close", () => { if (--left) go(); else { server.close(); console.log("done"); } });
  };
  go();
});
