import { createServer } from "node:http";
var i = 0;

// The headers go to writeHead() with no header set before, as fastify, astro and connect-node send them.
const server = createServer((req, res) => {
  const body = "Hello, World!" + i;
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-cache",
    "X-Request-Id": "" + i,
  });
  res.end(body);
  if (i++ === 200_000 - 1)
    setTimeout(() => {
      console.log("RSS", (process.memoryUsage().rss / 1024 / 1024) | 0, "MB");
      process.exit(0);
    }, 0);
}).listen(parseInt(process.env.PORT || "3000", 10));
