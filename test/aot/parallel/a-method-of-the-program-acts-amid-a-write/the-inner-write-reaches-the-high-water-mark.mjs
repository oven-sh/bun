// As it-lays-an-accessor-and-writes-once-more.mjs, at the high water mark: what both calls answer, and whether 'drain' comes.
import http from "node:http";
let line = [],
  lays = true;
const server = http.createServer({ highWaterMark: 64 }, (req, res) => {
  const original = res.getHeader;
  let acted = false;
  res.getHeader = function (name) {
    if (!acted) {
      acted = true;
      if (lays) Object.defineProperty(this, "madeUp", { configurable: true, get: () => 1 });
      line.push("inner " + this.write("x".repeat(this.writableHighWaterMark)));
    }
    return Reflect.apply(original, this, [name]);
  };
  res.once("drain", () => {
    line.push("drain");
    res.end();
  });
  line.push("outer " + res.write("out"));
  setTimeout(() => {
    if (!res.writableEnded) {
      line.push("no drain");
      res.end();
    }
  }, 300);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (lays of [true, false]) {
  line = [];
  const body = await (await fetch(url)).text();
  console.log((lays ? "laid" : "none laid") + ": " + body.length + " | " + line.join(" . "));
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
