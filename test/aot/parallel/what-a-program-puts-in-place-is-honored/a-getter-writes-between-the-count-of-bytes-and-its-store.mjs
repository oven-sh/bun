// write() reads the length of a chunk; a getter there lays an accessor under a private name above the response, and that accessor's getter writes again, with a callback, between write()'s count and its store. The body, writableLength and the order of the callbacks are as without compilation.
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
  let stored,
    nested = false;
  Object.defineProperty(chunk, "length", {
    get() {
      Object.defineProperty(above, names.kBytesBuffered, {
        configurable: true,
        get() {
          if (!nested) {
            nested = true;
            log.push("getter");
            res.write("cd", () => log.push("callback of the inner write"));
          }
          return stored;
        },
        set(value) {
          stored = value;
        },
      });
      return 2;
    },
  });
  res.on("finish", () => log.push("finish"));
  res.write(chunk, () => log.push("callback of the outer write"));
  seen = String(res.writableLength);
  res.end("ef", () => {
    log.push("callback of end");
    delete above[names.kBytesBuffered];
  });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
await (await fetch(url)).text();
const body = await (await fetch(url)).text();
await new Promise(resolve => setTimeout(resolve, 30));
console.log(body + " | writableLength " + seen + " | " + log.join(" . "));
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
