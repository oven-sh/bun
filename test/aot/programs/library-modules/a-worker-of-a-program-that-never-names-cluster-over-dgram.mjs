// As a-worker-of-a-program-that-never-names-cluster-over-http, over node:dgram.
import { createSocket } from "node:dgram";
const socket = createSocket("udp4");
socket.on("error", error => console.log("error:", error.code, error.message));
process.on("uncaughtException", error => {
  console.log("uncaught:", error.code, error.message);
  socket.close();
});
socket.on("listening", () => {
  console.log("listening");
  socket.close();
});
try {
  socket.bind(0);
} catch (error) {
  console.log("threw:", error.code, error.message);
}
