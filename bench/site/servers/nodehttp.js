const http = require("http");
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.end("Hello World!");
});
server.listen(0, () => console.log(`node:http listening on port ${server.address().port}`));
