// compatibility.mdx, "Error messages": the message names the value. `bun run` names the expression in Bun's own source: "OutgoingMessagePrototype.setHeader.@call is not a function. (In ..".
import http from "node:http";
Object.defineProperty(http.OutgoingMessage.prototype, "setHeader", { configurable: true, writable: true, value: null });
const server = http.createServer((request, response) => {
  try {
    response.setHeader("Content-Length", "2");
  } catch (error) {
    console.log(error.name, error.message);
  }
  response.end("ok");
});
server.listen(0, async () => {
  await fetch("http://localhost:" + server.address().port).then(answer => answer.text());
  server.close();
});
/* Output:
TypeError null is not a function (near '...OutgoingMessagePrototype.setHeader...')
*/
