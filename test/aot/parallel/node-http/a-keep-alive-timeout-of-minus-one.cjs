// A server's keepAliveTimeout of -1 goes out in the Keep-Alive header as without compilation.
const http = require("node:http");
const server = http.createServer((req, res) => res.end("x"));
server.keepAliveTimeout = -1;
server.listen(0, () =>
  http.get({ port: server.address().port, agent: new http.Agent({ keepAlive: true }) }, res => {
    console.log(res.headers["keep-alive"]);
    res.resume();
    res.on("end", () => process.exit(0));
  }),
);
