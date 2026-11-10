// A program that takes functions of node:fs by their names never holds the module's object and cannot replace one: node:net goes on calling them bare, and the rest of node:fs does not come.
// STATISTIC: ImageFunctionsEmitted <= 2700
import { existsSync } from "node:fs";
import { createServer } from "node:http";
const server = createServer((request, response) => response.end("x " + request.url + " " + existsSync("/")));
server.listen(0, async () => {
  const answer = await fetch(`http://127.0.0.1:${server.address().port}/a?b`);
  console.log(answer.status, await answer.text());
  server.close();
});
