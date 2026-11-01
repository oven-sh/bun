// An untyped listener forwards the request and the response to untyped helpers. node:http declares the argument types of a listener,
// so none of these functions looks up a member of the request or the response by name.
// COUNT: arrivals <= 8200
const http = require("node:http");
function route(req) {
  if (req.method !== "GET") return 405;
  return req.url === "/text" ? 200 : 404;
}
function send(res, status, text) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Length", text.length);
  res.end(text);
}
function listener(req, res) {
  const status = route(req);
  send(res, status, status === 200 ? "Hello, World!" : "no");
}
const server = http.createServer(listener);
server.listen(0, "127.0.0.1", async () => {
  const seen = new Map();
  for (let i = 0; i < 300; i++) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${i % 3 ? "/text" : "/other"}`, { method: i % 5 ? "GET" : "PUT" });
    const line = `${response.status} ${response.headers.get("content-type")} ${await response.text()}`;
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }
  for (const [line, times] of seen) console.log(times, line);
  server.close();
});
