import http from "node:http";
import net from "node:net";
const guard = setTimeout(() => { console.log("SAID guard"); process.exit(1); }, 8000);
const ask = (port, raw) => new Promise((resolve) => {
  let text = "";
  const socket = net.connect(port, "127.0.0.1", () => socket.write(raw));
  socket.on("data", (chunk) => { text += chunk.toString("latin1"); if (text.endsWith("ok\n")) socket.destroy(); });
  socket.on("close", () => resolve(text.split("\r\n\r\n")[0].replace(/^Date: .*$/gim, "Date: <date>").split("\r\n")));
});
const server = http.createServer((req, res) => { res.setHeader("Content-Length", 3); res.end("ok\n"); });
server.listen(0, "127.0.0.1", async () => {
  for (const timeout of [5000, 5000, 1500, 1500, "5000", 5000, 999, 999, 0, 5000, Infinity, Infinity, NaN, -1500, -1500, 5000]) {
    server.keepAliveTimeout = timeout;
    console.log(`SAID ${String(timeout)} | ${(await ask(server.address().port, "GET / HTTP/1.1\r\nHost: a\r\n\r\n")).join(" | ")}`);
  }
  server.close(() => clearTimeout(guard));
});
