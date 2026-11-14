// All that a program can ask of a response that nothing has been done to yet, then of one that has been given a head, then of one that has ended: the state behind it is made in one piece.
import http from "node:http";

const asked = res => [
  res.statusCode, JSON.stringify(res.statusMessage), res.headersSent, res.finished, res.writableEnded, res.writableFinished, res.writableLength, res.writableCorked,
  res.writableNeedDrain, res.sendDate, res.shouldKeepAlive, res.chunkedEncoding, res.useChunkedEncodingByDefault, res.destroyed, res.closed,
  JSON.stringify(res.getHeaderNames()), JSON.stringify(res.getRawHeaderNames()), JSON.stringify(res.getHeaders()), res.hasHeader("date"), res.getHeader("x-one"), res.strictContentLength,
].join(" ");

const server = http.createServer((req, res) => {
  console.log(req.url, "fresh:", asked(res));
  if (req.url === "/head") {
    res.setHeader("X-One", "1");
    res.setHeader("x-two", ["a", "b"]);
    res.setHeader("X-Three", 3);
    res.removeHeader("x-one");
    res.statusCode = 201;
    res.statusMessage = "Made";
    console.log(req.url, "with a head:", asked(res));
  } else if (req.url === "/many") {
    for (let i = 0; i < 12; i++) res.setHeader("x-" + i, i % 2 ? String(i) : i);
    console.log(req.url, "with many:", asked(res));
  } else if (req.url === "/written") {
    res.writeHead(202, { "content-type": "text/plain", "x-four": "4" });
    res.write("a");
    console.log(req.url, "written to:", asked(res));
  }
  res.on("finish", () => console.log(req.url, "finished:", asked(res)));
  res.on("close", () => console.log(req.url, "closed:", asked(res)));
  res.end("ok", () => console.log(req.url, "the callback of end"));
  console.log(req.url, "ended:", asked(res));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
for (const path of ["/", "/head", "/many", "/written", "/"]) {
  await new Promise(resolve => {
    http.get({ port: server.address().port, host: "127.0.0.1", path, agent: false }, response => {
      const headers = Object.entries(response.headers).filter(([name]) => name !== "date").map(([name, value]) => name + "=" + value).join(";");
      let text = "";
      response.setEncoding("utf8").on("data", chunk => (text += chunk)).on("close", () => {
        console.log(path, "the client:", response.statusCode, response.statusMessage, headers, JSON.stringify(text));
        setTimeout(resolve, 20);
      });
    });
  });
}
server.close();
