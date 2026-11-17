// What the printer lists of a request, of its response and of their socket, for the first request of a connection and for the next one: the order in which each was laid, symbols among the names.
import http from "node:http";

const keysShown = text => [...text.matchAll(/^  (\[?[A-Za-z_$][\w$]*(?:\([^)]*\))?\]?):/gm)].map(match => match[1]).join(" ");
const printed = object => keysShown(Bun.inspect(object, { depth: 0 }));
const server = http.createServer((req, res) => {
  console.log(req.url, "the request:", printed(req));
  console.log(req.url, "the response:", printed(res));
  console.log(req.url, "the socket:", printed(req.socket));
  res.setHeader("X-One", "1");
  res.write("a");
  console.log(req.url, "the response, written to:", printed(res));
  res.end("b");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
console.log(await (await fetch(url + "/first")).text());
console.log(await (await fetch(url + "/second")).text());
server.close();
