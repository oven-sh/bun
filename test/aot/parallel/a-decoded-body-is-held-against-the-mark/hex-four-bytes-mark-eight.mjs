import http from "node:http";
import net from "node:net";
let client;
const sent = "hell";
const server = http.createServer({ highWaterMark: 8 }, (req, res) => {
  req.socket.on("pause", () => console.log("socket paused"));
  req.setEncoding("hex");
  let text = "";
  req.on("readable", () => { let piece; while ((piece = req.read()) !== null) text += piece; });
  req.on("end", () => { console.log(text.length, JSON.stringify(text)); res.end("ok"); });
  setImmediate(() => client.write(sent));
});
server.listen(0, "127.0.0.1", () => {
  client = net.connect(server.address().port, "127.0.0.1", () =>
    client.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: " + Buffer.byteLength(sent) + "\r\nConnection: close\r\n\r\n"));
  client.resume();
  client.on("close", () => server.close());
});
