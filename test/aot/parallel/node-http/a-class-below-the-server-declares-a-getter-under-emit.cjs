// A class below http.Server declares `get emit()`: it is asked, and the function that it hands out is the one that is called. How often it is asked is not printed.
const http = require("node:http");
const net = require("node:net");
let asked = 0;
const called = [];
class Mine extends http.Server {
  get emit() {
    asked++;
    return function (name, ...all) {
      called.push(String(name));
      return http.Server.prototype.emit.call(this, name, ...all);
    };
  }
}
const server = new Mine((req, res) => res.end("heard"));
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let n = 0;
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  client.on("data", () => {
    if (++n < 3) return void setTimeout(ask, 10);
    console.log("asked " + (asked > 0) + " | " + called.filter(name => name === "request" || name === "connection").join());
    client.destroy();
    server.close();
  });
  ask();
});
