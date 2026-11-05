// Callbacks handed over: node:http calls the request listener with (IncomingMessage, ServerResponse), and the message's "data" listener with a Buffer, or with a string once an encoding is set; the program's own calls pass strings.
import { createServer } from "node:http";

let total = 0;

function onData(chunk: string): void {
  total += typeof chunk === "string" ? chunk.length : Buffer.isBuffer(chunk) ? 100 : 10000;
}

onData("a");
const server = createServer((request, response) => {
  if (request.url === "/text") request.setEncoding("utf8");
  request.on("data", onData);
  request.on("end", () => {
    total += typeof request.headers["x-n"] === "string" ? 1000000 : 0;
    response.end("ok");
  });
});
server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  for (const path of ["/text", "/bytes"]) await (await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", body: "hello", headers: { "x-n": "1" } })).text();
  server.close(() => console.log(total));
});
