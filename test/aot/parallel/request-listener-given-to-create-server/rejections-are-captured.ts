import http from "node:http";
import { EventEmitter } from "node:events";
import net from "node:net";
const lines: string[] = [];
const say = (line: string) => void lines.push(line);
// What the library throws outside of a listener is held by its name: its text and its frames are the library's own.
process.on("uncaughtException", error => say(`uncaught ${(error as Error).name} ${(error as Error).message}`));
type Listener = (this: unknown, req: http.IncomingMessage, res: http.ServerResponse) => void;
// A listener that says who it is, what it was called on and with how much, and answers unless somebody has.
const listenerNamed = (name: string, server: () => http.Server): Listener =>
  function (this: unknown, req, res) {
    say(`${name}: this is the server ${this === server()}, ${arguments.length} arguments, ${req.method} ${req.url}`);
    if (!res.writableEnded) res.end(name);
  };
// One connection for all the requests, each with a Host header and nothing else: from the second on they go the library's short way.
async function ask(server: http.Server, paths: string[], between: (turn: number) => void = () => {}) {
  await new Promise<void>(listening => server.listen(0, "127.0.0.1", listening));
  const { port } = server.address() as { port: number };
  const client = net.connect(port, "127.0.0.1");
  await new Promise<void>(connected => client.once("connect", connected));
  client.on("error", () => {});
  let received = "";
  let arrived: () => void = () => {};
  client.setEncoding("latin1");
  client.on("data", piece => ((received += piece), arrived()));
  client.on("close", () => arrived());
  const isWhole = () => {
    const end = received.indexOf("\r\n\r\n");
    if (end < 0) return false;
    const length = /content-length: (\d+)/i.exec(received.slice(0, end));
    return length ? received.length >= end + 4 + Number(length[1]) : received.endsWith("0\r\n\r\n");
  };
  for (let turn = 0; turn < paths.length; turn++) {
    between(turn);
    received = "";
    if (client.destroyed) {
      say(`${turn}: the connection is gone`);
      continue;
    }
    client.write(`GET ${paths[turn]} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
    const deadline = Date.now() + 400;
    while (!isWhole() && !client.destroyed && Date.now() < deadline) await Promise.race([new Promise<void>(resolve => (arrived = resolve)), new Promise(resolve => setTimeout(resolve, 50))]);
    const end = received.indexOf("\r\n\r\n");
    say(isWhole() ? `${turn}: client ${received.slice(9, 12)} ${JSON.stringify(received.slice(end + 4).replace(/^[0-9a-f]+\r\n|\r\n0\r\n\r\n$/g, ""))}` : `${turn}: client has no answer`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  client.destroy();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  console.log(lines.join("\n"));
}
process.on("unhandledRejection", error => say(`unhandled rejection ${(error as Error).name}`));
EventEmitter.captureRejections = true;
const server: http.Server = http.createServer(async function (this: unknown, req, res) {
  say(`given: this is the server ${this === server}, ${req.url}`);
  if (req.url === "/b2") throw new RangeError("rejected");
  res.end("given");
});
await ask(server, ["/a", "/a2", "/b", "/b2", "/c", "/c2"]);
