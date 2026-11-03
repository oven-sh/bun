// A handler takes the map of headers off its response, asks for headers and ends the response.
const http = require("node:http");
const { kOutHeaders } = require("node:_http_outgoing");
const server = http.createServer((req, res) => {
  res.setHeader("X-One", "1");
  if (req.url === "/delete") delete res[kOutHeaders];
  else res[kOutHeaders] = undefined;
  const uses = {
    getHeaders: () => JSON.stringify(res.getHeaders()),
    getHeaderNames: () => res.getHeaderNames(),
    hasHeader: () => res.hasHeader("x-one"),
    getHeader: () => res.getHeader("x-one"),
    removeHeader: () => res.removeHeader("x-one"),
    writeHead: () => typeof res.writeHead(200),
    end: () => typeof res.end("ok"),
  };
  for (const name in uses) {
    try {
      console.log(req.url, name, String(uses[name]()));
    } catch (error) {
      console.log(req.url, name, "throws", error.name);
    }
  }
  req.socket.destroy();
});
server.listen(0, async () => {
  for (const path of ["/delete", "/undefined"])
    await fetch("http://127.0.0.1:" + server.address().port + path).then(
      response => response.text(),
      error => console.log("the client fails", error.code),
    );
  server.close();
});
/* Output:
/delete getHeaders {}
/delete getHeaderNames throws TypeError
/delete hasHeader throws TypeError
/delete getHeader throws TypeError
/delete removeHeader throws TypeError
/delete writeHead throws TypeError
/delete end throws TypeError
the client fails ECONNRESET
/undefined getHeaders {}
/undefined getHeaderNames throws TypeError
/undefined hasHeader throws TypeError
/undefined getHeader throws TypeError
/undefined removeHeader throws TypeError
/undefined writeHead throws TypeError
/undefined end throws TypeError
the client fails ECONNRESET
*/
