import { once } from "node:events";
import { createServer } from "node:http";

const server = createServer(async (req, res) => {
  if (req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    res.setHeader("X-Length", String(body.length));
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(body.toUpperCase());
    return;
  }
  if (req.url === "/stream") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    for (const part of ["a", "b", "c"]) res.write(part);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": 2 });
  res.end("ok");
});
server.listen(0);
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(await (await fetch(origin + "/")).text());
console.log(await (await fetch(origin + "/stream")).text());
const posted = await fetch(origin + "/", { method: "POST", body: "hello" });
console.log(posted.headers.get("x-length"), await posted.text());
server.close();
