// A getter under statusCode looks around while write() takes the status of a head that it sends with the first chunk: the head does not count as sent yet.
import http from "node:http";
let line = [],
  way = "";
const server = http.createServer((req, res) => {
  if (way === "a length") res.setHeader("Content-Length", "2");
  res.writeHead = function () {
    let value = res.statusCode;
    Object.defineProperty(res, "statusCode", {
      configurable: true,
      enumerable: true,
      get() {
        line.push("get " + res.headersSent);
        return value;
      },
      set(next) {
        line.push("set " + res.headersSent);
        value = next;
      },
    });
    return this;
  };
  res.write("ab");
  res.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (way of ["a length", "chunks"]) {
  line = [];
  const body = await (await fetch(url)).text();
  console.log(way + ": " + body + " | " + line.join(" . "));
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
