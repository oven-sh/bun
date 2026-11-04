// A program that never names node:cluster holds nothing of a worker. Here NODE_UNIQUE_ID stands in its environment and there is no channel to a primary: the child of a cluster worker inherits the variable.
// It listens. `bun run` listens with node:http, and waits for ever for a primary with node:net and node:dgram. Node.js deletes the variable at start and waits for ever with all three.
// With a channel (another program's setupPrimary({ exec })) it says, where it would listen, that node:cluster isn't in the executable.
// Env: NODE_UNIQUE_ID=1
import { createSocket } from "node:dgram";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
const listen = server =>
  new Promise(resolve => {
    server.on("error", error => resolve(error.code));
    server.listen(0, () => server.close(() => resolve("listening")));
  });
console.log("node:http", await listen(createServer(() => {})));
console.log("node:net", await listen(createNetServer(() => {})));
const socket = createSocket("udp4");
console.log(
  "node:dgram",
  await new Promise(resolve => {
    socket.on("error", error => resolve(error.code));
    socket.bind(0, () => socket.close(() => resolve("bound")));
  }),
);
/* Output:
node:http listening
node:net listening
node:dgram bound
*/
