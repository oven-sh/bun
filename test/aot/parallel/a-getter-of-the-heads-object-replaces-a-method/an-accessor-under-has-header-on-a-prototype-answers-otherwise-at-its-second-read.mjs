// writeHead() calls hasHeader() twice to learn how the body is framed, and each call reads the name. An accessor under that name on a prototype, which leaves the response itself as its class made it, hands back the library's own function, a wrapper, or another function at its second read. How often it is read, what is called and how the body is framed are as without compilation.
import http from "node:http";
const holder = http.OutgoingMessage.prototype,
  original = holder.hasHeader;
let log = [],
  way = "";
function lay() {
  let reads = 0;
  Object.defineProperty(holder, "hasHeader", {
    configurable: true,
    enumerable: true,
    get() {
      log.push("get");
      reads++;
      if (way === "the library's own") return original;
      if (way === "a wrapper")
        return function (name) {
          log.push("call " + name);
          return Reflect.apply(original, this, [name]);
        };
      return reads === 1 ? original : () => true;
    },
  });
}
const server = http.createServer((req, res) => {
  lay();
  res.writeHead(200);
  Object.defineProperty(holder, "hasHeader", { configurable: true, enumerable: true, writable: true, value: original });
  res.end("body");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (way of ["the library's own", "a wrapper", "another at the second read"]) {
  log = [];
  const response = await fetch(url),
    body = await response.text();
  console.log(
    way +
      ": " +
      log.join(", ") +
      " | " +
      response.headers.get("content-length") +
      " " +
      response.headers.get("transfer-encoding") +
      " " +
      body,
  );
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
