// RUN: link
// OPTIONS: builtin-modules
// CHECK: module {{*}}path="internal:cluster/child"

// A server holds the half of a cluster's worker only where the program names node:cluster.

// FILE: main.js
import "node:cluster";
import { createServer } from "node:http";
const server = createServer((request, response) => response.end("hello " + request.url));
server.listen(0, async () => {
  const answer = await fetch("http://127.0.0.1:" + server.address().port + "/a");
  console.log(answer.status, await answer.text());
  server.close();
});
