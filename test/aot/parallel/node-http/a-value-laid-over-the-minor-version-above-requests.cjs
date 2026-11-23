// file: p13-minor-version.cjs         plain close undefined | P keep-alive 1
const http = require("node:http");
http.IncomingMessage.prototype.httpVersionMinor = 0;
const server = http.createServer((req, res) => res.end("x"));
server.listen(0, () =>
  http.get({ port: server.address().port, agent: new http.Agent({ keepAlive: true }) }, r => {
    console.log(r.headers.connection, r.headers["content-length"]);
    r.resume();
    r.on("end", () => process.exit(0));
  }),
);
