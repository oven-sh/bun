// Guards that fail once: canary node http server. It prints what plain Bun prints.
import { createServer } from "node:http";
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end(`${request.method} ${request.url}`);
});
server.listen(0, async () => {
  const answer = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/one`);
  console.log(answer.status, answer.headers.get("content-type"), await answer.text());
  server.close();
});
