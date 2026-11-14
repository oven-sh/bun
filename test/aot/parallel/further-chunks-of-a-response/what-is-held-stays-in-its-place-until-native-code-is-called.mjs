// write("ok") under a Content-Length is held, and end() means to send it with the head in one call. An accessor under _trailer or strictContentLength that writes once more amid that end() finds the chunk in its place and sends it first: the body is whole. A writeHead() of the program's own that writes amid end() gets its chunk out too, and end() throws as without compilation.
import http from "node:http";
let way = "", line = "";
const server = http.createServer((req, res) => {
  const lay = name => {
    const own = res[name]; let reads = 0;
    Object.defineProperty(res, name, { configurable: true, get() { if (++reads === 1) res.write("y"); return own; }, set(value) {} });
  };
  try {
    if (way.startsWith("writeHead")) {
      res.setHeader("Content-Length", "1");
      const original = res.writeHead;
      res.writeHead = function (...values) { original.apply(this, values); this.write("x"); return this; };
      if (way === "writeHead in front") { res.writeHead(200); res.end(); } else res.end("k");
    } else {
      res.setHeader("Content-Length", "3");
      res.write("ok");
      if (way === "in front") res.write("y"); else lay(way);
      res.end();
    }
    line = "returns";
  } catch (error) { line = "throws " + error.name + " " + error.code; }
  try { if (!res.writableEnded) res.end(); } catch (error) { line += " . then " + error.code; res.destroy(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
for (way of ["writeHead amid end", "writeHead in front", "_trailer", "strictContentLength", "in front"]) {
  let seen = "no body";
  try { seen = await (await fetch("http://127.0.0.1:" + server.address().port, { signal: AbortSignal.timeout(3000) })).text(); } catch {}
  console.log(way + ": " + line + " . " + seen);
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
