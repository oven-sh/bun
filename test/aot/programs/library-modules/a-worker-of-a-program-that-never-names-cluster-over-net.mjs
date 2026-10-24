// As a-worker-of-a-program-that-never-names-cluster-over-http, over node:net.
import { createServer } from "node:net";
const server = createServer(() => {});
server.on("error", error => console.log("error:", error.code, error.message));
server.on("listening", () => {
  console.log("listening");
  server.close();
});
try {
  server.listen(0);
} catch (error) {
  console.log("threw:", error.code, error.message);
}
