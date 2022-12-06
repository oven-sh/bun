import { createServer } from "node:http";
var i = 0;

const server = createServer((req, res) => {
  res.writeHead(200);
  res.end("Hello, World!" + i);
  if (i++ === 200_000 - 1) queueMicrotask(() => process.exit(0));
}).listen(parseInt(process.env.PORT || "3000", 10));
