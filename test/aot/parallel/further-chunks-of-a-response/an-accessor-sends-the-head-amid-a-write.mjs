// An accessor of the program on a name that write() reads sends the head by flushHeaders(): write() sends no second head, and it reads each name as often as without compilation.
import http from "node:http";
let name = "";
const log = [];
const server = http.createServer((req, res) => {
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
    log.push(`${name} write ${res.write("o")}`);
  } catch (error) {
    log.push(`${name} ${error.name} ${error.code}`);
  }
  reads = 1;
  res.write("k");
  log.push(`${name} reads ${reads - 1}`);
  res.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
name = "sendDate";
await (await fetch(url)).text();
for (name of ["strictContentLength", "_hasBody", "statusCode", "_callPendingCallbacks", "getHeader"]) log.push(`${name} ${await (await fetch(url)).text()}`);
await new Promise(resolve => server.close(resolve));
console.log(log.join("\n"));
