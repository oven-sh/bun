import http from "node:http";

const server = http.createServer((request, response) => {
  response.setHeader("Set-Cookie", ["a=1; Path=/", "b=2"]);
  response.setHeader("X-Number", 5);
  response.setHeader("X-Gone", "soon");
  response.appendHeader?.("X-List", "one");
  response.appendHeader?.("X-List", "two");
  response.removeHeader("x-gone");
  const seen = {
    has: [response.hasHeader("X-NUMBER"), response.hasHeader("x-gone")],
    number: response.getHeader("x-number"),
    names: response.getHeaderNames(),
    cookie: response.getHeaders()["set-cookie"],
    method: request.method,
    url: request.url,
    version: request.httpVersion + " " + request.httpVersionMajor,
    raw: request.rawHeaders.filter((_, index) => index % 2 === 0).map(name => name.toLowerCase()).filter(name => name.startsWith("x-")),
    twice: request.headers["x-twice"],
    distinct: request.headersDistinct?.["x-twice"],
    cookie2: request.headers.cookie,
    host: typeof request.headers.host,
    remote: request.socket.remoteAddress,
    complete: request.complete,
    sent: response.headersSent,
  };
  response.writeHead(201, "Made", { "Content-Type": "application/json", "X-Late": ["p", "q"] });
  try {
    response.setHeader("x-too-late", "1");
  } catch (error) {
    seen.late = error.code;
  }
  response.end(JSON.stringify(seen));
});

server.keepAliveTimeout = 1000;
server.listen(0, "127.0.0.1", async () => {
  const headers = new Headers({ "x-one": "1", cookie: "s=1; t=2" });
  headers.append("x-twice", "a");
  headers.append("x-twice", "b");
  const answer = await fetch("http://127.0.0.1:" + server.address().port + "/path?q=1", { method: "PATCH", headers, body: "x" });
  console.log(answer.status, answer.statusText, answer.headers.getSetCookie(), answer.headers.get("x-number"), answer.headers.get("x-list"), answer.headers.get("x-late"), answer.headers.has("x-gone"));
  console.log(await answer.json());
  console.log(http.STATUS_CODES[404], http.STATUS_CODES[999], http.METHODS.includes("PATCH"), http.METHODS.length > 20, typeof http.globalAgent.maxSockets, http.maxHeaderSize, server.listening, server.timeout, server.requestTimeout);
  try {
    http.validateHeaderName("bad name");
  } catch (error) {
    console.log(error.code);
  }
  try {
    http.validateHeaderValue("x", "bad\nvalue");
  } catch (error) {
    console.log(error.code);
  }
  server.closeAllConnections();
  server.close(error => console.log("closed", error));
});
