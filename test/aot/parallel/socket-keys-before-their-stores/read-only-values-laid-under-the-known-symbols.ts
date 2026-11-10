import http from "node:http";
import type { Socket } from "node:net";
const lines: string[] = [];
const say = (line: string) => void lines.push(line);
// What the library throws outside of the handler is held by its name: its text and its frames are the library's own.
process.on("uncaughtException", error => say(`uncaught ${(error as Error).name}`));
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, turn: number) => void;
// Every connection serves so many requests, one behind the other, and is closed behind the last.
async function connections(count: number, requestsOfEach: number, handler: Handler, onConnection: (socket: Socket, connection: number) => void = () => {}) {
  let turn = 0;
  let connection = 0;
  let closed: () => void = () => {};
  const server = http.createServer((req, res) => {
    res.on("close", () => closed());
    handler(req, res, turn);
  });
  server.on("connection", socket => onConnection(socket, connection));
  await new Promise<void>(listening => server.listen(0, "127.0.0.1", listening));
  const { port } = server.address() as { port: number };
  for (; connection < count; connection++) {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    for (let request = 0; request < requestsOfEach; request++, turn++) {
      const isClosed = new Promise<void>(resolve => (closed = resolve));
      await new Promise<void>(answered => {
        const sent = http.get({ host: "127.0.0.1", port, path: "/", agent }, answer => {
          let text = "";
          answer.setEncoding("utf8");
          answer.on("data", piece => (text += piece));
          answer.on("end", () => (say(`${turn}: client ${answer.statusCode} ${JSON.stringify(text)}`), answered()));
        });
        sent.on("error", () => (say(`${turn}: client fails`), answered()));
      });
      await Promise.race([isClosed, new Promise(resolve => setTimeout(resolve, 500))]);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    agent.destroy();
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
  console.log(lines.join("\n"));
}
const described = (keys: (string | symbol)[]) => keys.map(key => (typeof key === "symbol" ? `@${key.description}` : key)).join(" ");
function stages(req: http.IncomingMessage, res: http.ServerResponse, look: (stage: string) => void) {
  look("start");
  req.on("end", () => look("end of the request"));
  req.on("close", () => look("close of the request"));
  res.on("finish", () => look("finish of the response"));
  res.on("close", () => look("close of the response"));
  req.resume();
  look("resume");
  res.end("body");
  look("end of the response");
}
// The symbols that a socket has got once it has served a request and did not have when it was connected.
const late = new Set<symbol>();
function noteLateSymbols(atConnection: symbol[], socket: Socket) {
  for (const symbol of Object.getOwnPropertySymbols(socket)) if (!atConnection.includes(symbol)) late.add(symbol);
}
const byDescription = (symbols: Iterable<symbol>) => [...symbols].sort((a, b) => String(a.description).localeCompare(String(b.description)));
let atConnection: symbol[] = [];
await connections(
  3,
  3,
  (req, res, turn) => {
    const socket = req.socket;
    // The second request of a connection finds the slots filled, and from here on they may not be written.
    if (turn >= 3 && turn % 3 === 1) for (const symbol of byDescription(late)) Object.defineProperty(socket, symbol, { value: `held ${turn}`, writable: false, configurable: true, enumerable: true });
    const look = (stage: string) => say(`${turn} ${stage}: ${byDescription(late).map(symbol => `@${symbol.description} ${typeof (socket as any)[symbol] === "string" ? (socket as any)[symbol] : typeof (socket as any)[symbol]}`).join(" ")}`);
    try {
      stages(req, res, look);
    } catch (error) {
      say(`${turn}: ${(error as Error).name}`);
      socket.destroy();
    }
    res.on("close", () => noteLateSymbols(atConnection, socket));
  },
  socket => void (atConnection = Object.getOwnPropertySymbols(socket)),
);
