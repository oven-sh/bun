// A TCP net.Socket whose 'data' listener throws with no 'uncaughtException' handler; the peer sends "hi" and FIN together.
const net = require("node:net");
const seen = [];
const server = net.createServer(s => { s.end("hi"); }).listen(0, "127.0.0.1", () => {
  const c = net.connect(server.address().port, "127.0.0.1");
  c.on("data", () => { seen.push("data"); throw new Error("boom"); });
  c.on("end", () => seen.push("end"));
  c.on("close", () => { seen.push("close"); server.close(); });
});
server.unref();
process.on("exit", code => console.log(JSON.stringify({ code, seen })));
