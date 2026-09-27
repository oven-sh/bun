// A server for connection-per-request load: each client opens a connection, sends one
// request and closes it. `ab` does this when it runs without -k.
//
//   bun http-connection-per-request.mjs [Bun.serve | Bun.listen | node:http | node:net]
//   node http-connection-per-request.mjs [node:http | node:net]
//   ab -n 100000 -c 64 http://127.0.0.1:3000/
//
// Each second with requests it prints the count and the CPU time of the server per request.
import http from "node:http";
import net from "node:net";

const kind = process.argv[2] ?? (typeof Bun === "undefined" ? "node:http" : "Bun.serve");
const port = Number(process.env.PORT ?? 3000);
const body = "Hello, World!";
const response = `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`;

let requests = 0;

switch (kind) {
  case "Bun.serve":
    Bun.serve({
      port,
      fetch() {
        requests++;
        return new Response(body);
      },
    });
    break;
  case "Bun.listen":
    Bun.listen({
      hostname: "0.0.0.0",
      port,
      socket: {
        data(socket) {
          requests++;
          socket.end(response);
        },
      },
    });
    break;
  case "node:http":
    http
      .createServer((req, res) => {
        requests++;
        res.end(body);
      })
      .listen(port);
    break;
  case "node:net":
    net
      .createServer(socket => {
        socket.on("error", () => {});
        socket.on("data", () => {
          requests++;
          socket.end(response);
        });
      })
      .listen(port);
    break;
  default:
    throw new Error(`unknown server "${kind}"`);
}

console.log(`${kind} on port ${port}`);

let last = { requests, cpu: process.cpuUsage() };
setInterval(() => {
  const cpu = process.cpuUsage();
  const count = requests - last.requests;
  if (count) {
    const micros = cpu.user - last.cpu.user + (cpu.system - last.cpu.system);
    console.log(`${count} requests, ${(micros / count).toFixed(1)} us of CPU per request`);
  }
  last = { requests, cpu };
}, 1000);
