import http from "node:http";
import net from "node:net";
const notes = [];
const server = http.createServer((req, res) => {
  const odd = (text, deed) => { let looks = 0; return { toString() { if (++looks === 2) deed(); return text; } }; };
  res.setHeader("7", "seven");
  res.setHeader("X-First", odd("odd", () => res.removeHeader("X-Second")));
  res.setHeader("X-Second", "2");
  res.setHeader("X-Third", "3");
  res.setHeader("Content-Length", 2);
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  let text = "";
  const client = net.connect(server.address().port, "127.0.0.1", () => client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n"));
  client.on("data", piece => (text += piece));
  client.on("close", () => {
    console.log(JSON.stringify(text.split("\r\n").filter(line => !/^date:/i.test(line)).join("|")), notes.join());
    server.close();
  });
});
