// The toString() of a header's value lays an accessor under statusCode while the head is made. Its getter takes a head and then stores another status message, which comes too late. What the client gets is as without compilation.
import http from "node:http";
let way = "",
  armed = false;
const server = http.createServer((req, res) => {
  res.setHeader("x-made-up", {
    toString() {
      if (!armed) return "1";
      armed = false;
      let value = res.statusCode,
        acted = false;
      Object.defineProperty(res, "statusCode", {
        configurable: true,
        enumerable: true,
        get() {
          if (!acted) {
            acted = true;
            res.writeHead(201, "First");
            res.statusMessage = "Late";
          }
          return value;
        },
        set(next) {
          value = next;
        },
      });
      return "2";
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
