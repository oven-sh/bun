// The library keeps the two numbers of HTTP/1.1 on IncomingMessage.prototype and reads them once, not at every request. Whoever stores another there is heard: the short roads are left.
// Here it is done between two requests.
import http from "node:http";
const later = () => { http.IncomingMessage.prototype.httpVersionMinor = 0; };
const seen = [];
const server = http.createServer((request, response) => {
  seen.push([request.httpVersionMajor, request.httpVersionMinor, request.httpVersion, Object.hasOwn(request, "httpVersionMinor"), response.shouldKeepAlive].join(" "));
  response.end("ok");
});
server.listen(0, async () => {
  const headers = [];
  for (let turn = 0; turn < 4; turn++) {
    if (turn === 2) later();
    const answer = await fetch(`http://127.0.0.1:${server.address().port}/`);
    headers.push(answer.headers.get("connection") + " " + (await answer.text()));
  }
  console.log(seen.join(" | "));
  console.log(headers.join(" | "));
  server.close();
});
