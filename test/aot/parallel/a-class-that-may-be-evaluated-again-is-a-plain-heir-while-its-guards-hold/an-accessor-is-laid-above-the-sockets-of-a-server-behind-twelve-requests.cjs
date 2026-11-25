const http = require("node:http");
const nothing = () => {};
const seen = [];
const said = [];
function watch(holder) {
  let kept;
  Object.defineProperty(holder, "_readableState", {
    get() { seen.push("read"); return kept; },
    set(value) { seen.push("stored"); kept = value; },
    configurable: true,
  });
}
function listen(socket) {
  const before = seen.length;
  socket.on("error", nothing);
  socket.removeListener("error", nothing);
  return seen.length - before;
}
const server = http.createServer((request, response) => {
  said.push(listen(request.socket));
  if (said.length === 12) watch(Object.getPrototypeOf(request.socket));
  response.end("done");
});
server.listen(0, async () => {
  const port = server.address().port;
  for (let turn = 0; turn < 24; turn++) await (await fetch(`http://127.0.0.1:${port}/`, { headers: { connection: "close" } })).text();
  console.log(said.join(""));
  server.close();
});
