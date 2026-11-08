// Both methods are replaced in front of the load of node:http. Four requests on one connection.
const net = require("node:net");
const { Readable } = require("node:stream");
let server;
const calls = { resume: 0, removeListener: 0 };
const count = (holder, name) => {
  const original = holder[name];
  holder[name] = function (...given) {
    if (server !== undefined && this.server === server) calls[name]++;
    return original.apply(this, given);
  };
};
count(net.Socket.prototype, "resume");
count(Readable.prototype, "removeListener");
const http = require("node:http");
function run(done) {
  server = http.createServer((req, res) => res.end("ok"));
  server.listen(0, () => {
    const client = net.connect(server.address().port, "127.0.0.1");
    let answers = 0;
    const ask = () => client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    client.on("connect", ask);
    client.on("data", bytes => {
      if (!String(bytes).endsWith("ok")) return;
      if (++answers < 4) return void setTimeout(ask, 10);
      setTimeout(() => {
        console.log("answers " + answers + " resume " + calls.resume + " removeListener " + calls.removeListener);
        client.destroy();
        server.close(done);
      }, 20);
    });
  });
}
run(() => {});
/* Output:
answers 4 resume 4 removeListener 4
*/
