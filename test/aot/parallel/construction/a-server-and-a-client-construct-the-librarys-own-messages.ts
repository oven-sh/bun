import http from "node:http";
const log: string[] = [];
const server = http.createServer((request, response) => {
  log.push([request instanceof http.IncomingMessage, response instanceof http.ServerResponse, request.method, request.url, typeof request.headers.host, response.writableEnded, response.headersSent].join(" "));
  response.end("answer " + request.url);
});
server.listen(0, "127.0.0.1", async () => {
  const port = (server.address() as any).port;
  const first = Number(process.argv[2] ?? 3);
  for (let turn = first; turn < first + 3; turn++) log.push(await (await fetch("http://127.0.0.1:" + port + "/" + turn)).text());
  server.close(() => console.log(log.join("\n")));
});
