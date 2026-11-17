// The road of internal:http1_server_fallback: `server.emit("connection", socket)` over a socket of node:net. The client reads slowly, so write() meets backpressure and the response waits for 'drain'.
// The stand-in for the native handle keeps the drain callback behind `set onwritable(callback)`. Stored plainly into the slot of that field the callback was never found, and the response stood still for good.
const http = require("node:http"), net = require("node:net");
const chunk = Buffer.alloc(256 * 1024, 120);
const log = [];
const server = http.createServer((req, res) => {
  let sent = 0, refused = 0, drains = 0;
  res.on("finish", () => log.push("finish"));
  res.on("close", () => log.push("close"));
  const step = () => {
    while (sent < 40) {
      sent++;
      if (!res.write(chunk)) { refused++; res.once("drain", () => { drains++; step(); }); return; }
    }
    log.push("sent " + sent + " refused>0 " + (refused > 0) + " drains==refused " + (drains === refused) + " needDrain " + res.writableNeedDrain);
    res.end("end");
  };
  step();
});
const tcp = net.createServer((socket) => server.emit("connection", socket));
tcp.listen(0, "127.0.0.1", () => {
  const client = net.connect(tcp.address().port, "127.0.0.1");
  let received = 0, head = "";
  client.on("data", (data) => {
    if (!received) head = data.toString("latin1").split("\r\n\r\n")[0].split("\r\n").filter((line) => !/^date:/i.test(line)).join("|");
    received += data.length;
    client.pause();
    setTimeout(() => client.resume(), 2);
  });
  client.on("end", () => done("end"));
  client.on("close", () => done("close"));
  client.write("GET /x HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n");
  const timer = setTimeout(() => done("the response never went on"), 20000);
  let isDone = false;
  function done(why) {
    if (isDone) return;
    isDone = true;
    clearTimeout(timer);
    setTimeout(() => { console.log(why, received, head); console.log(log.join(" . ")); process.exit(0); }, 50);
  }
});
