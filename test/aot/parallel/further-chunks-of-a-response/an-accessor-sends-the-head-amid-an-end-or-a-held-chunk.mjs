// An accessor of the program on a name that end() or write() reads sends the head by flushHeaders(): amid end(), amid the write() that would keep its chunk, and amid a second write() behind a chunk that is kept.
import http from "node:http";
let name = "", way = "";
const log = [];
const server = http.createServer((req, res) => {
  if (way !== "end") res.setHeader("Content-Length", "2");
  if (way === "second") res.write("o");
  const own = res[name];
  let reads = 0;
  Object.defineProperty(res, name, {
    configurable: true,
    get() {
      if (++reads === 1) res.flushHeaders();
      return own;
    },
    set(value) {},
  });
  try {
    if (way === "end") res.end("ok");
    else {
      res.write(way === "second" ? "k" : "ok");
      res.end();
    }
    log.push(`${way} ${name} done`);
  } catch (error) {
    log.push(`${way} ${name} ${error.name} ${error.code}`);
    res.destroy();
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for ([way, name] of [["end", "statusCode"], ["end", "_hasBody"], ["end", "_trailer"], ["first", "getHeader"], ["first", "strictContentLength"], ["second", "_hasBody"]]) {
  try {
    log.push(`${way} ${name} ${await (await fetch(url)).text()}`);
  } catch {
    log.push(`${way} ${name} no body`);
  }
}
await new Promise(resolve => server.close(resolve));
console.log(log.join("\n"));
