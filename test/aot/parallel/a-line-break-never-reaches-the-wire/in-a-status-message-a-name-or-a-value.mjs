// A carriage return and a line feed in a status message, in the name or the value of a header or of a trailer: each way is refused, and what goes out on the wire holds no line of the program's making.
import { createServer, ServerResponse, IncomingMessage } from "node:http";
import { connect } from "node:net";
const said = [];
const bad = "ok\r\nInjected: yes";
const server = createServer((req, res) => {
  const how = req.url.slice(1);
  try {
    if (how === "message") {
      res.statusMessage = bad;
      res.writeHead(200);
    }
    if (how === "head") res.writeHead(200, bad);
    if (how === "header") res.setHeader("x-a", bad);
    if (how === "name") res.setHeader("x-a\r\nInjected", "1");
    if (how === "trailer") {
      res.setHeader("trailer", "x-t");
      res.write("a");
      res.addTrailers({ "x-t": bad });
    }
    if (how === "object") res.writeHead(200, { "x-b": bad });
    if (how === "append") res.appendHeader("x-c", bad);
    said.push(how + " returned");
  } catch (e) {
    said.push(how + " " + e.code);
  }
  try {
    res.statusMessage = "OK";
    res.end("body");
  } catch (e) {
    res.destroy();
  }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
for (const how of ["message", "head", "header", "name", "trailer", "object", "append"]) {
  const raw = await new Promise((resolve, reject) => {
    let all = "";
    const s = connect(port, "127.0.0.1", () =>
      s.write("GET /" + how + " HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"),
    );
    s.on("data", d => (all += d));
    s.on("close", () => resolve(all));
    s.on("error", reject);
  });
  said.push(how + " on the wire: " + (/\r\nInjected: yes|\r\nInjected: 1/.test(raw) ? "INJECTED" : "clean"));
}
server.close();
console.log(said.join("\n"));
