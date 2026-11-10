// Where a _construct lies above all requests, a fresh request holds under its own symbols what it holds without one.
const http = require("node:http");
const net = require("node:net");

const shown = value => (typeof value === "function" ? "function" : value !== null && typeof value === "object" ? "object" : String(value));
const kinds = {
  "nothing laid": () => {},
  "a function": above => { above._construct = function (done) { done(); }; },
  "a function that is late": above => { above._construct = function (done) { setTimeout(done, 5); }; },
  "null": above => { above._construct = null; },
  "a number": above => { above._construct = 1; },
};
(async () => {
  for (const name in kinds) {
    const above = http.IncomingMessage.prototype;
    kinds[name](above);
    const said = [];
    const server = http.createServer((req, res) => {
      said.push(Object.getOwnPropertySymbols(req).map(symbol => String(symbol).slice(7, -1) + "=" + shown(req[symbol])).sort().join(" "));
      res.end("x");
    });
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    const line = await new Promise(done => {
      const socket = net.connect(server.address().port, "127.0.0.1");
      let got = "";
      const limit = setTimeout(() => socket.destroy(), 500);
      socket.on("data", chunk => { got += chunk.toString("latin1"); if (got.includes("\r\n\r\nx")) socket.destroy(); });
      socket.on("close", () => { clearTimeout(limit); done(got.replace(/Date: [A-Z][^\r]*GMT/, "Date: <now>").replace(/\r\n/g, " | ")); });
      socket.on("error", () => {});
      socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
    });
    console.log(name + ": " + line);
    console.log("   " + said.join("\n   "));
    delete above._construct;
    server.close();
    server.closeAllConnections();
  }
})();
