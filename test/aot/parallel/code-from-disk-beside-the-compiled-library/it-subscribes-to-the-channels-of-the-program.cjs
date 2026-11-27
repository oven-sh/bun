// The program never names the module of diagnostics channels. A file from disk subscribes to what the compiled library publishes.
// Flags: --aot-allow-code-from-disk
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "subscribes-from-disk-"));
const file = path.join(folder, "late.cjs");
fs.writeFileSync(
  file,
  `
const { subscribe } = require("node:" + ["diagnostics", "channel"].join("_"));
module.exports = say => {
  for (const name of [
    "http.server.response.created", "http.server.request.start", "http.server.response.finish", "net.client.socket",
    "http.client.request.start", "http.client.response.finish", "undici:request:create", "undici:request:trailers",
  ])
    subscribe(name, () => say(name));
};
`,
);

const heard = [];
const server = http
  .createServer((request, response) => response.end())
  .listen(0, "127.0.0.1", async () => {
    const url = "http://127.0.0.1:" + server.address().port;
    const get = () => new Promise(resolve => http.get(url, response => response.resume().on("end", resolve)));
    await get();
    await get();
    require(file)(name => heard.push(name));
    await get();
    await (await fetch(url)).text();
    http.globalAgent.destroy();
    await get();
    server.close();
    server.closeAllConnections();
    fs.rmSync(folder, { recursive: true });
    console.log(heard.sort().join("\n"));
  });
