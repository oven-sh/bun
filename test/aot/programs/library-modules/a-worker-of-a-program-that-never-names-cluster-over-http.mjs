// A program that never names node:cluster holds nothing of a worker. Started as one all the same (another program's setupPrimary({ exec }) sets NODE_UNIQUE_ID), it says so where it would listen,
// and does not listen as a primary would.
import { createServer } from "node:http";
const server = createServer(() => {});
server.on("error", error => console.log("error:", error.code, error.message));
server.on("listening", () => {
  console.log("listening");
  server.close();
});
server.listen(0);
