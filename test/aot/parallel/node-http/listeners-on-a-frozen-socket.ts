// Listeners are added to the socket of a connection through an heir and through a Proxy, a later request freezes the socket, and the server closes every connection.
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";

const lines: string[] = [];
const say = (...parts: unknown[]) => void lines.push(parts.map(String).join(" "));

function nameCallers(error: unknown) {
  return String((error as Error)?.stack)
    .split("\n")
    .slice(1, 3)
    .map(line => line.trim().split(" ")[1])
    .join(" < ");
}

process.on("uncaughtException", error =>
  say("nobody caught", (error as Error)?.name, (error as Error)?.message, nameCallers(error)),
);

function countListeners(socket: Socket) {
  return ["close", "error", "timeout"].map(event => `${event} ${socket.listenerCount(event)}`).join(", ");
}

let heirWithTimeout: Socket;

const handlers: http.RequestListener[] = [
  (_request, response) => {
    const socket = response.socket!;
    (Object.create(socket) as Socket).once("close", () => say("close, heard through an heir"));
    new Proxy(socket, {}).once("close", () => say("close, heard through a Proxy"));
    socket.once("close", () => say("close, heard on the socket"));
    say("first request:", countListeners(socket));
    response.end("done");
  },
  (request, response) => {
    Object.freeze(request.socket);
    say("second request:", countListeners(request.socket), Object.isFrozen(request.socket));
    response.end("done");
  },
  (request, response) => {
    say("third request:", countListeners(request.socket));
    response.end("done");
  },
  (request, response) => {
    heirWithTimeout = Object.create(request.socket) as Socket;
    heirWithTimeout.setTimeout(60_000);
    Object.freeze(heirWithTimeout);
    try {
      heirWithTimeout.setTimeout(0);
      say("the timeout of a frozen heir is cleared");
    } catch (error) {
      say("clearing the timeout of a frozen heir throws", (error as Error)?.name, (error as Error)?.message);
    }
    response.end("done");
  },
];

let turn = 0;
const server = http.createServer((request, response) => handlers[turn++](request, response));
await once(server.listen(0, "127.0.0.1"), "listening");
const { port } = server.address() as AddressInfo;
// The request that follows the freeze reaches no handler.
for (let index = 0; index < handlers.length + 1; index++) {
  try {
    const answer = await fetch(`http://127.0.0.1:${port}/${index}`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
    });
    say("answer", index, answer.status, await answer.text());
  } catch (error) {
    say("no answer", index, (error as Error)?.name);
  }
  await new Promise(resolve => setTimeout(resolve, 5));
}
say("closing");
server.closeAllConnections();
server.close();
await new Promise(resolve => setTimeout(resolve, 20));
console.log(lines.join("\n"));
process.exit(0);
