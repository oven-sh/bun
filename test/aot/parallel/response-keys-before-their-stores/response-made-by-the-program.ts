import http from "node:http";
const lines: string[] = [];
const say = (line: string) => void lines.push(line);
// What the library throws outside of the handler is held by its name: its text and its frames are the library's own.
process.on("uncaughtException", error => say(`uncaught ${(error as Error).name}`));
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, turn: number) => void;
async function exchanges(count: number, handler: Handler, options: http.ServerOptions = {}) {
  let turn = 0;
  let closed: () => void = () => {};
  const server = http.createServer(options, (req, res) => {
    res.on("close", () => closed());
    handler(req, res, turn);
  });
  await new Promise<void>(listening => server.listen(0, "127.0.0.1", listening));
  const { port } = server.address() as { port: number };
  for (; turn < count; turn++) {
    const isClosed = new Promise<void>(resolve => (closed = resolve));
    try {
      const answer = await fetch(`http://127.0.0.1:${port}/`, { headers: { connection: "close" } });
      say(`${turn}: client ${answer.status} ${JSON.stringify(await answer.text())}`);
    } catch (error) {
      say(`${turn}: client fails`);
    }
    await Promise.race([isClosed, new Promise(resolve => setTimeout(resolve, 500))]);
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
  console.log(lines.join("\n"));
}
const described = (keys: (string | symbol)[]) => keys.map(key => (typeof key === "symbol" ? `@${key.description}` : key)).join(" ");
function stages(res: http.ServerResponse, look: (stage: string) => void) {
  look("start");
  res.setHeader("x-a", "1");
  look("setHeader");
  res.writeHead(200, { "content-type": "text/plain" });
  look("writeHead");
  res.write("a");
  look("write");
  res.on("finish", () => look("finish"));
  res.on("close", () => look("close"));
  res.end("b");
  look("end");
}
await exchanges(1, (req, res, turn) => {
  const own = new http.ServerResponse(req);
  say(`made: ${described(Reflect.ownKeys(own))}`);
  own.statusCode = 201;
  own.setHeader("x-b", "2");
  say(`header: ${described(Reflect.ownKeys(own))}`);
  res.end("body");
});
