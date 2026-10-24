import http from "node:http";

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && url.pathname === "/hello") {
    response.writeHead(200, { "Content-Type": "text/plain", "X-Name": url.searchParams.get("name") ?? "nobody" });
    response.end("hello " + (url.searchParams.get("name") ?? "nobody"));
    return;
  }
  if (request.method === "POST" && url.pathname === "/sum") {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      let numbers;
      try {
        numbers = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        response.statusCode = 400;
        response.end("bad json");
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ sum: numbers.reduce((total, n) => total + n, 0), type: request.headers["content-type"] }));
    });
    return;
  }
  response.statusCode = 404;
  response.end("not found: " + request.method + " " + url.pathname);
});

server.listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const hello = await fetch(base + "/hello?name=Ada");
  console.log(hello.status, hello.headers.get("content-type"), hello.headers.get("x-name"), await hello.text());
  const sum = await fetch(base + "/sum", { method: "POST", headers: { "content-type": "application/json" }, body: "[1, 2, 3.5]" });
  console.log(sum.status, await sum.json());
  const bad = await fetch(base + "/sum", { method: "POST", body: "[1," });
  console.log(bad.status, await bad.text());
  const missing = await fetch(base + "/nothing", { method: "DELETE" });
  console.log(missing.status, await missing.text());
  server.close(() => console.log("closed"));
});
