import { createServer } from "node:http";
var i = 0;

const server = createServer((req, res) => {
  res.writeHead(200);
  res.end("Hello, World!" + i);
  if (i++ === 200_000 - 1)
    setTimeout(() => {
      console.log("RSS", (process.memoryUsage().rss / 1024 / 1024) | 0, "MB");
      process.exit(0);
    }, 0);
}).listen(parseInt(process.env.PORT || "3000", 10));
