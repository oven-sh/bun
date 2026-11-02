// RUN: link
// OPTIONS: builtin-modules
// CHECK-NOT: path="internal:cluster/child"
// CHECK-NOT: function {{*}}name="socketOnData"

// Not the client's half of node:http, and of a cluster only what says that this is the primary.

// FILE: main.js
import { createServer } from "node:http";
const server = createServer((request, response) => response.end("hello " + request.url));
server.listen(0, async () => {
  const answer = await fetch("http://127.0.0.1:" + server.address().port + "/a");
  console.log(answer.status, await answer.text());
  server.close();
});
