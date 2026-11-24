// A getHeader() of the program's own, called by write(), lays a count of bytes on the prototype of responses: writableLength counts from it, as without compilation.
import http from "node:http";
let names = null,
  seen = "";
const above = http.ServerResponse.prototype;
const server = http.createServer((req, res) => {
  if (names === null) {
    res.write("fi");
    names = {};
    for (const symbol of Object.getOwnPropertySymbols(res)) names[symbol.description] = symbol;
    return res.end("rst");
  }
  const own = res.getHeader;
  res.getHeader = function (name) {
    above[names.kBytesBuffered] = 5;
    return own.call(this, name);
  };
  res.write("body");
  seen = String(res.writableLength);
  delete above[names.kBytesBuffered];
  res.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
await (await fetch(url)).text();
const got = await fetch(url),
  body = await got.text();
console.log(Object.keys(names).includes("kBytesBuffered") + " | " + seen + " | " + got.status + " | " + body);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
