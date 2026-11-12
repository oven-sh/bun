const http = require("node:http");
const net = require("node:net");
let armed = false;
function handle(req, res) {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  const list = ["a"];
  Object.defineProperty(list, 0, { enumerable: true, configurable: true, get() { if (armed) res.removeHeader("x-later"); return "a"; } });
  res.setHeader("x-list", list);
  res.setHeader("x-later", "1");
  armed = true;
  res.end("ok");
  armed = false;
}
const server = http.createServer(handle);
server.listen(0, "127.0.0.1", () => {
  let text = "";
  const client = net.connect(server.address().port, "127.0.0.1", () => client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n"));
  client.on("data", chunk => (text += chunk));
  client.on("close", () => {
    const names = text.split("\r\n\r\n")[0].split("\r\n").slice(1).map(line => line.split(":")[0].toLowerCase()).filter(name => name.startsWith("x-"));
    console.log(`SAID ${names.join()}`);
    server.close();
  });
});
