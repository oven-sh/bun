// An accessor of the program under _trailer writes a chunk amid end(), and the chunk is kept: it goes out. One under sendDate sends the head while write() makes the head for a chunk that it would keep: write() throws what native code throws at a second head.
import http from "node:http";
let name = "";
const log = [];
const server = http.createServer((req, res) => {
  res.setHeader("Content-Length", "2");
  const own = res[name];
  let reads = 0;
  Object.defineProperty(res, name, {
    configurable: true,
    get() {
      if (++reads === 1) {
        if (name === "_trailer") res.write("ok");
        else res.flushHeaders();
      }
      return own;
    },
    set(value) {},
  });
  try {
    if (name !== "_trailer") log.push(`${name} write ${res.write("ok")}`);
    res.end();
    log.push(`${name} done`);
  } catch (error) {
    log.push(`${name} ${error.name} ${error.code} ${error.message}`);
    res.destroy();
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (name of ["_trailer", "sendDate", "_trailer", "sendDate"]) {
  try {
    log.push(`${name} ${JSON.stringify(await (await fetch(url)).text())}`);
  } catch {
    log.push(`${name} no body`);
  }
}
await new Promise(resolve => server.close(resolve));
console.log(log.join("\n"));
