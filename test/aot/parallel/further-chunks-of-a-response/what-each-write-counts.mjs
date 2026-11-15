// What a response holds as written in one turn: the bytes of each chunk, and the frame of a chunk where no length was given.
import http from "node:http";
import net from "node:net";
const log = [];
let requests = 0;
const chunks = ["a", "", "ééé", Buffer.from("four"), new Uint8Array(17), "x".repeat(256), Buffer.alloc(0), "\u{1F600}"];
const server = http.createServer((req, res) => {
  requests++;
  if (requests % 2 === 0) res.setHeader("Content-Length", 1 + 6 + 4 + 17 + 256 + 4);
  const counted = [];
  for (const chunk of chunks) counted.push(`${res.write(chunk)} ${res.writableLength}`);
  log.push(`${requests}: ${counted.join(", ")}`);
  setImmediate(() => {
    log.push(`${requests} later: ${res.writableLength} ${res.write("")} ${res.writableLength}`);
    res.end();
  });
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  let answers = 0;
  let seen = "";
  client.on("connect", ask);
  client.on("data", (bytes) => {
    seen += bytes.toString("latin1");
    const isWhole = answers % 2 === 0 ? seen.endsWith("0\r\n\r\n") : seen.length - seen.indexOf("\r\n\r\n") - 4 === 288;
    if (!isWhole) return;
    seen = "";
    if (++answers < 4) return void ask();
    client.destroy();
    server.close();
    console.log(log.join("\n"));
  });
});
