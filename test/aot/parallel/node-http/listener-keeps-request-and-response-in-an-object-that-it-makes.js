// A listener without types stores the request and the response in an object that it makes and hands that object on. Functions without types read the two back out of it.
// The library declares what it gives a listener, and what is stored in the object is what is read out of it, so none of them looks a member of the two up by its name.
// COUNT: arrivals <= 8200
const http = require("node:http");
const base = {
  get path() {
    return this.req.url;
  },
};
function createContext(req, res) {
  const context = Object.create(base);
  context.req = req;
  context.res = res;
  return context;
}
function route(context) {
  const req = context.req;
  if (req.method !== "GET") return 405;
  return req.url === "/text" ? 200 : 404;
}
function send(context, status, text) {
  const res = context.res;
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Length", text.length);
  res.end(text);
}
function listener(req, res) {
  const context = createContext(req, res);
  const status = route(context);
  send(context, status, status === 200 ? "Hello, World!" : context.path);
}
const server = http.createServer(listener);
server.listen(0, "127.0.0.1", async () => {
  const seen = new Map();
  for (let i = 0; i < 300; i++) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${i % 3 ? "/text" : "/other"}`, {
      method: i % 5 ? "GET" : "PUT",
    });
    const line = `${response.status} ${response.headers.get("content-type")} ${await response.text()}`;
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }
  for (const [line, times] of seen) console.log(times, line);
  server.close();
});
