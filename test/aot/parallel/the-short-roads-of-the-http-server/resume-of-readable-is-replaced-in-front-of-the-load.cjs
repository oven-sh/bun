// Readable.prototype.resume is replaced before node:http is loaded: the server calls it for each request, on the short road too.
const { Readable } = require("node:stream");
let server;
let calls = 0;
const original = Readable.prototype.resume;
Readable.prototype.resume = function () {
  if (server !== undefined && this.server === server) calls++;
  return original.call(this);
};
const http = require("node:http");
const net = require("node:net");
server = http.createServer((req, res) => res.end("ok"));
server.listen(0, () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let answers = 0;
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
  client.on("connect", ask);
  client.on("data", (bytes) => {
    if (!String(bytes).endsWith("ok")) return;
    if (++answers < 4) return void setTimeout(ask, 10);
    setTimeout(() => {
      console.log("answers " + answers + " resume " + calls);
      client.destroy();
      server.close();
    }, 20);
  });
});
/* Output:
answers 4 resume 4
*/
