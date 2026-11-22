// write() reads the length of a chunk. A getter under that name, laid on the chunk by the program, lays a count of bytes on the prototype of responses: writableLength counts from it, as without compilation.
import http from "node:http";
let names = null,
  seen = "",
  log = [];
const above = http.ServerResponse.prototype;
const server = http.createServer((req, res) => {
  if (names === null) {
    res.write("fir");
    names = {};
    for (const symbol of Object.getOwnPropertySymbols(res)) names[symbol.description] = symbol;
    return res.end("st");
  }
  const chunk = new Uint8Array([97, 98]);
  Object.defineProperty(chunk, "length", {
    get() {
      log.push("get");
      above[names.kBytesBuffered] = 5;
      return 2;
    },
  });
  res.write(chunk);
  seen = String(res.writableLength);
  delete above[names.kBytesBuffered];
  res.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
await (await fetch(url)).text();
const body = await (await fetch(url)).text();
console.log(body + " | " + log.join(" ") + " | writableLength " + seen);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
