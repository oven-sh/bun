// A node:http server written as an ES module: what it schedules while it starts runs in the order of plain Bun and Node, promise jobs first.
import { createServer } from "node:http";
const log: string[] = [];
const server = createServer((request, response) => response.end("ok"));
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
server.listen(0, "127.0.0.1", () => {
  log.push("listening");
  server.close(() => console.log(log.join(", ")));
});
