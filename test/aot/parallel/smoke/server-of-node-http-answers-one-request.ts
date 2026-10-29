// A server of node:http answers one request of the program itself and closes. It brings in a large part of the library.
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
