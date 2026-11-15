// A chunk is held, trailers are added, and a hasHeader() of the program's own runs amid end(). What it sees read off the response is as without compilation.
import http from "node:http";
let line = [],
  way = "";
const trace = res => {
  let value = res._eventsCount;
  Object.defineProperty(res, "_eventsCount", {
    configurable: true,
    enumerable: true,
    get() {
      line.push("get");
      return value;
    },
    set(next) {
      line.push("set");
      value = next;
    },
  });
};
const server = http.createServer((req, res) => {
  const original = res.hasHeader;
  let acted = way !== "amid the end";
  res.setHeader("Content-Length", "2");
  res.addTrailers({ "x-made-up": "1" });
  res.hasHeader = function (name) {
    if (!acted) {
      acted = true;
      trace(this);
      this.write("");
    }
    return Reflect.apply(original, this, [name]);
  };
  res.write("ab");
  if (way === "in front of the end") trace(res);
  res.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (way of ["amid the end", "in front of the end"]) {
  line = [];
  const body = await (await fetch(url)).text();
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  console.log(way + ": " + body + " | " + line.join(" . "));
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
