const http = require("node:http");
const server = http.createServer((req, res) => {
  let reads = 0;
  Object.defineProperty(res, "_header", { configurable: true, get() { reads++; return ""; }, set() {} });
  res.setHeader("a", "b"); console.log(reads); process.exit(0);
});
server.listen(0, () => http.get({ port: server.address().port }));
