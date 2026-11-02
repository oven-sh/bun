// The headers of a response are kept in an object, which lists its array indices first, in ascending order.
const http = require("node:http");
const server = http.createServer((req, res) => {
  res.setHeader("x-a", "1");
  res.setHeader("7", "seven");
  res.setHeader("x-b", "2");
  res.setHeader("3", "three");
  res.setHeader("07", "no index");
  res.setHeader("4294967295", "no index");
  res.setHeader("4294967294", "the last index");
  const seen = [res.getHeaderNames(), res.getRawHeaderNames(), Object.keys(res.getHeaders()), res.getHeader("7"), res.hasHeader("3")];
  res.removeHeader("3");
  seen.push(res.getHeaderNames());
  res.end(JSON.stringify(seen));
});
server.listen(0, "127.0.0.1", async () => {
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    console.log(await response.text());
    console.log(response.headers.get("7"), response.headers.get("3"), response.headers.get("x-b"));
  }
  server.close();
});
