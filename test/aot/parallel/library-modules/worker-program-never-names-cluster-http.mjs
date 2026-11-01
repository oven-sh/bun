// A program that never names node:cluster holds nothing of a worker. Started as one all the same (another program's setupPrimary({ exec }) sets NODE_UNIQUE_ID), it says so where it would listen,
// and does not listen as a primary would.
// Env: NODE_UNIQUE_ID=1
import { createServer } from "node:http";
const server = createServer(() => {});
server.on("error", error => console.log("error:", error.code, error.message));
server.on("listening", () => {
  console.log("listening");
  server.close();
});
server.listen(0);
/* Output:
error: MODULE_NOT_FOUND Cannot load 'node:cluster': it isn't in this executable. Import it by name somewhere in your program to keep it. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
