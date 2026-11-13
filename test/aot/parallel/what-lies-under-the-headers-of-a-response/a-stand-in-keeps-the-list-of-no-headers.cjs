const http = require("node:http");
const net = require("node:net");
const said = []; const kept = []; let turn = 0;
const freezes = JSON.parse("false");
function handle(req, res) {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  const now = turn++;
  if (now === 0) {
    const symbol = Object.getOwnPropertySymbols(res).find(it => it.description === "handle");
    const real = res[symbol];
    res[symbol] = {
      get flags() { return real.flags; }, get finished() { return real.finished; }, get bufferedAmount() { return real.bufferedAmount; },
      writeWholeResponse() { return undefined; },
      writeHeadAndEnd(status, message, headers, ...rest) {
        kept.push(headers);
        if (freezes) { headers.push("X-Made-Up", "1"); Object.freeze(headers); }
        return real.writeHeadAndEnd(status, message, [], ...rest);
      },
    };
  }
  if (now === 1 && !freezes) res.setHeader("x-b", "2");
  try { res.end("ok"); said.push("ended"); } catch (error) { said.push(error.constructor.name); req.socket.destroy(); }
}
const server = http.createServer(handle);
const ask = port => new Promise(resolve => {
  const client = net.connect(port, "127.0.0.1", () => client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n"));
  client.on("data", () => {}); client.on("error", () => {}); client.on("close", resolve);
});
server.listen(0, "127.0.0.1", async () => {
  for (let i = 0; i < 4; i++) await ask(server.address().port);
  console.log(`SAID ${said.join()} [${kept[0].join()}]`);
  server.close();
});
