// An accessor under statusMessage answers otherwise at its second read. The message is read once.
import http from "node:http";
let way = "",
  armed = false;
const lay = res => {
  let reads = 0;
  Object.defineProperty(res, "statusMessage", {
    configurable: true,
    enumerable: true,
    get() {
      return ++reads === 1 ? "First" : "Second";
    },
    set() {},
  });
};
const server = http.createServer((req, res) => {
  res.setHeader("x-made-up", {
    toString() {
      if (armed) {
        armed = false;
        lay(res);
      }
      return "1";
    },
  });
  armed = true;
  if (way === "end") res.end("body");
  else {
    res.write("bo");
    res.end("dy");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (way of ["end", "write, end"]) {
  const got = await fetch(url),
    body = await got.text();
  console.log(way + ": " + got.status + " " + got.statusText + " " + body);
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
