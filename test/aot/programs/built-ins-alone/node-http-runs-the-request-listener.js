import { createServer } from "node:http";
const server = createServer(function (request, response) {
  console.log(request.method, request.url, typeof request.headers.host, this === server, arguments.length);
  response.setHeader("x-size", 1.5);
  response.end("answer");
});
await new Promise(resolve => server.listen(0, resolve));
const response = await fetch(`http://127.0.0.1:${server.address().port}/path`);
console.log(response.headers.get("x-size"), await response.text());
server.close();
