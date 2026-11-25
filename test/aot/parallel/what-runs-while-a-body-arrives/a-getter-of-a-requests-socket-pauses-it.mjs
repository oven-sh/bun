// A getter under `socket` on a request pauses it while a chunk of the body arrives.
import http from "node:http";
import net from "node:net";
const log = []; let go;
const server = http.createServer((req, res) => {
  const own = req.socket; let armed = true;
  req.on("data", c => log.push("data " + c.length));
  req.on("end", () => { log.push("end"); res.end("ok"); });
  setTimeout(() => {
    Object.defineProperty(req, "socket", { configurable: true, set() {}, get() {
      if (armed) { armed = false; req.pause(); setTimeout(() => { log.push("resume"); req.resume(); }, 30); }
      return own;
    } });
    go();
  }, 20);
});
server.listen(0, () => {
  const c = net.connect(server.address().port, "127.0.0.1");
  c.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\nConnection: close\r\n\r\n");
  go = () => c.write("hello");
  c.on("data", () => {});
  c.on("close", () => { console.log(log.join(" | ")); process.exit(0); });
});
