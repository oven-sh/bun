// compatibility.mdx, "Error messages": the message names the value. `bun run` names the expression in Bun's own source: "OutgoingMessagePrototype.cork.@call is not a function. (In ..".
import http from "node:http";
Object.defineProperty(http.OutgoingMessage.prototype, "cork", { configurable: true, writable: true, value: null });
const response = new http.ServerResponse(new http.IncomingMessage());
try {
  response.cork();
} catch (error) {
  console.log(error.name, error.message);
}
/* Output:
TypeError null is not a function (near '...OutgoingMessagePrototype.cork...')
*/
