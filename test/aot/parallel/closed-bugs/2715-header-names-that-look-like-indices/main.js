const http = require("node:http");
const server = http.createServer((req, res) => {
  res.setHeader("x-a", "1");
  res.setHeader("7", "seven");
  const names = JSON.stringify(res.getHeaderNames());
  res.end(names);
});
server.listen(0, "127.0.0.1", async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  console.log(await response.text());
  server.close();
});
