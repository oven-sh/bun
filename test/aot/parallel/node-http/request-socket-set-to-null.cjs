// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const http = require("node:http");
const net = require("node:net");

process.on("uncaughtException", error => console.log("uncaught " + error.name));

let when;
const server = http.createServer((req, res) => {
  if (when === "ahead of end()") req.socket = null;
  res.on("finish", () => console.log("  finish"));
  res.on("close", () => console.log("  close"));
  res.end("ok");
  if (when === "behind end()") req.socket = null;
});

function get(socket) {
  return new Promise(resolve => {
    let text = "";
    socket.on("data", function onData(chunk) {
      text += chunk;
      if (!text.endsWith("ok")) return;
      socket.off("data", onData);
      resolve(text.split("\r\n")[0]);
    });
    socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  });
}

server.listen(0, "127.0.0.1", async () => {
  for (when of ["never", "ahead of end()", "behind end()"]) {
    console.log(when);
    const socket = net.connect(server.address().port, "127.0.0.1");
    socket.setEncoding("latin1");
    await new Promise(resolve => socket.on("connect", resolve));
    for (let round = 0; round < 2; round++) {
      console.log("  " + (await get(socket)));
      await new Promise(resolve => setImmediate(resolve));
    }
    socket.destroy();
  }
  server.close();
  server.closeAllConnections();
});
