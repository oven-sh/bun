import http from "node:http";
const lines: string[] = [];
const say = (line: string) => void lines.push(line);
// What the library throws outside of the handler is held by its name: its text and its frames are the library's own.
process.on("uncaughtException", error => say(`uncaught ${(error as Error).name}`));
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, turn: number) => void;
async function exchanges(count: number, handler: Handler, body?: string) {
  let turn = 0;
  let closed: () => void = () => {};
  const server = http.createServer((req, res) => {
    res.on("close", () => closed());
    handler(req, res, turn);
  });
  await new Promise<void>(listening => server.listen(0, "127.0.0.1", listening));
  const { port } = server.address() as { port: number };
  for (; turn < count; turn++) {
    const isClosed = new Promise<void>(resolve => (closed = resolve));
    try {
      const answer = await fetch(`http://127.0.0.1:${port}/`, { method: body === undefined ? "GET" : "POST", body, headers: { connection: "close" } });
      say(`${turn}: client ${answer.status} ${JSON.stringify(await answer.text())}`);
    } catch (error) {
      say(`${turn}: client fails`);
    }
    await Promise.race([isClosed, new Promise(resolve => setTimeout(resolve, 500))]);
    await new Promise(resolve => setTimeout(resolve, 20));
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
await exchanges(2, (req, res, turn) => stages(req, res, stage => say(`${turn} ${stage}: ${described(Reflect.ownKeys(req))}`)));
