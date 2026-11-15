// STATISTIC: ImageFunctionsEmitted <= 2700
import { createServer } from "node:http";
const server = createServer((request, response) => response.end("x " + request.url));
server.listen(0, async () => {
  const answer = await fetch(`http://127.0.0.1:${server.address().port}/a?b`);
  console.log(answer.status, await answer.text());
  server.close();
});
