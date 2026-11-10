const { Readable } = require("node:stream");
const { createServer } = require("node:http");
const runOnce = require("./made-up-package.cjs");
const said = [];
const tell = (name, stream) =>
  said.push(name + ": " + Object.keys(stream).join() + " | " + Object.getOwnPropertySymbols(stream).map(String).join());
class Heir extends Readable {}
tell("a readable", new Readable());
tell("an heir", new Heir());
const finish = runOnce(server => {
  server.close();
  said.push("on functions: " + typeof finish.madeUpOnce);
  console.log(said.join("\n"));
});
const server = createServer((request, response) => {
  tell("a request", request);
  let bytes = 0;
  request.on("data", chunk => (bytes += chunk.length));
  request.on("end", () => response.end("bytes " + bytes));
});
server.listen(0, "127.0.0.1", async () => {
  const address = "http://127.0.0.1:" + server.address().port;
  for (const body of [undefined, "made up"])
    said.push(await (await fetch(address, body === undefined ? {} : { method: "POST", body })).text());
  finish(server);
  finish(server);
});
