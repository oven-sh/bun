// While write() keeps the first chunk of a response, an accessor of the program on a name that write() reads puts a process.nextTick of the program's own in place: it is handed what it is handed without compilation.
import http from "node:http";
const original = process.nextTick;
const turn = () => new Promise(resolve => setImmediate(resolve));
let name = "", at = 1, seen = [], reads = 0;
function replaceNextTick(req, res) {
  process.nextTick = function (callback, ...all) {
    seen.push((callback.name || "(anonymous)") + " " + all.map(one => (one === res ? "res" : one === req ? "req" : typeof one === "object" && one !== null ? one.constructor.name : typeof one)).join(","));
    return original.call(this, callback, ...all);
  };
}
const server = http.createServer((req, res) => {
  reads = 0;
  res.setHeader("Content-Length", 2);
  const own = res[name];
  Object.defineProperty(res, name, {
    configurable: true,
    get() {
      if (++reads === at) replaceNextTick(req, res);
      return own;
    },
    set(value) {
      Object.defineProperty(res, name, { configurable: true, writable: true, value });
    },
  });
  const took = res.write("ok");
  seen.push(`write ${took}`);
  res.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
await (await fetch(url + "/first")).text();
for (name of ["getHeader", "sendDate", "_keepAliveTimeout"]) {
  for (at = 1; at <= 2; at++) {
    seen = [];
    const text = await (await fetch(url + "/one")).text();
    await turn();
    await turn();
    process.nextTick = original;
    console.log(name, at, text, "|", seen.join(" . "));
  }
}
await new Promise(resolve => server.close(resolve));
