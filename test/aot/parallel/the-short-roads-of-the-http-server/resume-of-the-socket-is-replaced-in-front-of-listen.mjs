// net.Socket.prototype.resume is replaced at the top of the program, in front of the first listen(): the server calls it for each request, on the short road too.
import http from "node:http";
import net from "node:net";
let server;
let calls = 0;
let connections = 0;
const original = net.Socket.prototype.resume;
net.Socket.prototype.resume = function () {
  if (server !== undefined && this.server === server) calls++;
  return original.call(this);
};
server = http.createServer((req, res) => res.end("ok"));
server.on("connection", () => connections++);
server.listen(0, () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let answers = 0;
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
  client.on("connect", ask);
  client.on("data", (bytes) => {
    if (!String(bytes).endsWith("ok")) return;
    if (++answers < 4) return void setTimeout(ask, 10);
    setTimeout(() => {
      console.log("connections " + connections + " answers " + answers + " resume " + calls);
      client.destroy();
      server.close();
    }, 20);
  });
});
/* Output:
connections 1 answers 4 resume 5
*/
