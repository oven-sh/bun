import http from "node:http";
let turn = 0, line = "";
process.on("uncaughtException", error => { line += " . uncaught " + error.message; });
const server = http.createServer((req, res) => {
  if (turn++ === 0) return void res.end("first");
  res.end("k");
  const socket = req.socket;
  let value = socket._httpMessage, thrown = false;
  Object.defineProperty(socket, "_httpMessage", { configurable: true, enumerable: true, get() { return value; }, set(next) { if (!thrown) { thrown = true; throw new Error("made up"); } value = next; } });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
const first = await (await fetch(url)).text();
const second = await (await fetch(url)).text();
for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
console.log(first, second + line);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
