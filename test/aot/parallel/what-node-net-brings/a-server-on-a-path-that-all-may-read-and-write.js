const net = require("node:net");
const fs = require("node:fs");
const path = require("node:os").tmpdir() + "/made-up-" + process.pid + ".sock";
const server = net.createServer();
server.listen({ path, readableAll: true, writableAll: true }, () => {
  console.log((fs.statSync(path).mode & 0o66).toString(8));
  server.close(() => console.log("closed"));
});
