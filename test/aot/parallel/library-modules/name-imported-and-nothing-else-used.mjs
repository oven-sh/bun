// Only the name that is imported is used: the server answers.
import { createServer } from "node:http";
const server = createServer((request, response) => response.end("hello " + request.url));
server.listen(0, async () => {
  const answer = await fetch("http://127.0.0.1:" + server.address().port + "/a");
  console.log(answer.status, await answer.text());
  server.close();
});
