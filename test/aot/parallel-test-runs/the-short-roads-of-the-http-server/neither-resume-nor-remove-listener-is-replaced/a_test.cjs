// Neither method is replaced: the short roads are taken. Four requests on one connection, in a test.
const { test } = require("bun:test");
const net = require("node:net");
const { Readable } = require("node:stream");
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
let server;
const calls = { resume: 0, removeListener: 0 };
const count = (holder, name) => {
  const original = holder[name];
  holder[name] = function (...given) {
    if (server !== undefined && this.server === server) calls[name]++;
    return original.apply(this, given);
  };
};

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
      if (++answers < 4) return void spinEventLoop().then(ask);
      spinEventLoop().then(() => {
        console.log("answers " + answers + " resume " + calls.resume + " removeListener " + calls.removeListener);
        client.destroy();
        server.close(done);
      });
    });
  });
}
test("a", () => new Promise(resolve => run(resolve)), 60_000);
