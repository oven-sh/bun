// Whoever lists or prints what a server makes sees the same own names as without compilation, in the same order: a response at six moments of an answer, among them behind an empty chunk under a Content-Length; a connection that two requests were pipelined on; a response on a connection handed over by server.emit("connection", socket), which has no native handle.
import http from "node:http";
import net from "node:net";
const lines = [];
const names = object =>
  Reflect.ownKeys(object)
    .map(key => (typeof key === "symbol" ? `[${key.description}]` : key))
    .join(" ");
const note = (label, object) => lines.push(`${label}: ${names(object)}`);
const server = http.createServer((req, res) => {
  if (req.url === "/empty") {
    note("a response as made", res);
    res.setHeader("Content-Length", 0);
    note("behind a header", res);
    lines.push(`an empty chunk gives ${res.write("")}`);
    note("behind an empty chunk", res);
    res.end();
    note("behind its end", res);
    res.on("close", () => note("closed", res));
  } else if (req.url === "/kept") {
    res.setHeader("Content-Length", 2);
    res.write("ok");
    note("behind a chunk under a length", res);
    res.end();
  } else if (req.url === "/a" || req.url === "/b") {
    note(`the connection at ${req.url}`, req.socket);
    setTimeout(() => {
      res.end("x");
      if (req.url === "/b") setImmediate(() => note("the connection behind both", req.socket));
    }, 10);
  } else {
    const handle = Object.getOwnPropertySymbols(res).find(symbol => symbol.description === "handle");
    note("a response on a connection handed over", res);
    note("the connection handed over", req.socket);
    lines.push(`its handle: ${res[handle]}`);
    res.end("ok");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
for (const path of ["/empty", "/kept"]) await (await fetch(`http://127.0.0.1:${port}${path}`)).text();
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => {
  const client = net.connect(port, "127.0.0.1", () =>
    client.write("GET /a HTTP/1.1\r\nHost: h\r\n\r\nGET /b HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n"),
  );
  client.resume();
  client.on("close", resolve);
});
const front = net.createServer(socket => server.emit("connection", socket));
await new Promise(resolve => front.listen(0, "127.0.0.1", resolve));
lines.push(
  `over the connection handed over: ${await new Promise(resolve =>
    http.get({ host: "127.0.0.1", port: front.address().port, path: "/handed", agent: false }, got => {
      let text = "";
      got.on("data", chunk => (text += chunk)).on("end", () => resolve(`${got.statusCode} ${text}`));
    }),
  )}`,
);
await new Promise(resolve => front.close(resolve));
await new Promise(resolve => server.close(resolve));
console.log(lines.join("\n"));
