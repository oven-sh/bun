// A class below http.Server declares its own emit(): every event of the server goes through it, and what it swallows is not heard.
const http = require("node:http");
const net = require("node:net");
const seen = [];
let swallows = false;
class Mine extends http.Server {
  emit(name, ...all) {
    seen.push(String(name));
    if (swallows && name === "request") {
      all[1].end("swallowed");
      return true;
    }
    return super.emit(name, ...all);
  }
}
const server = new Mine((req, res) => res.end("heard"));
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const bodies = [];
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  client.on("data", bytes => {
    bodies.push(String(bytes).split("\r\n\r\n")[1]);
    if (bodies.length === 2) swallows = true;
    if (bodies.length < 4) return void setTimeout(ask, 10);
    console.log(bodies.join() + " | " + seen.filter(name => name === "request" || name === "connection").join());
    client.destroy();
    server.close();
  });
  ask();
});
